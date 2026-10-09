import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, get_db
from models import Device, DeviceType
from routers import digital_documents
from routers.auth import get_current_user


SIGNATURE = {
    'company_name': 'ООО Компания', 'inn': '0012345678', 'certificate_type': 'Тип вручную',
    'signature_kind': 'Вид вручную', 'full_name': 'Иванов Иван Иванович', 'position': 'Директор',
    'snils': '001-002-003 04', 'email': 'ivanov@example.com', 'application': 'Отчётность\nЭДО',
    'valid_from': '2026-01-01', 'valid_to': '2027-01-01', 'ep_state': 'Состояние из источника',
    'revoked_at': '2026-10-06T14:30:15+04:00', 'fingerprint': '0011aabbcc', 'serial_number': '00000123',
}
POWER = {
    'power_number': '000045', 'valid_from': '2026-01-01', 'valid_to': '2027-01-01',
    'grantor_inn': '0012345678', 'grantor_name': 'ООО Доверитель',
    'grantor_person_full_name': 'Иванов Иван', 'grantor_person_inn': '001234567890',
    'grantor_person_snils': '001-002-003 04', 'representative_full_name': 'Петров Пётр',
    'representative_inn': '009876543210', 'representative_snils': '009-008-007 06',
    'permissions': 'Подписывать документы\nПолучать сведения', 'fns_identifier': '0000-ФНС-ID',
    'edo_identifier': '0000-ЭДО-ID', 'edo_status': 'Статус из источника',
}


class DigitalDocumentsApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        self.app = FastAPI()
        self.app.include_router(digital_documents.router, prefix='/api/digital-documents')

        def db_override():
            with self.sessions() as db:
                yield db

        self.app.dependency_overrides[get_db] = db_override
        self.app.dependency_overrides[get_current_user] = lambda: {'username': 'test'}
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        clock = patch('routers.digital_documents.register_today', return_value=date(2026, 10, 6))
        clock.start()
        self.addCleanup(clock.stop)

    def endpoint(self, kind):
        return '/api/digital-documents/' + kind

    def create(self, kind, payload):
        response = self.client.post(self.endpoint(kind), json=payload)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_signature_round_trip_preserves_all_fields_and_leading_zeroes(self):
        created = self.create('signatures', SIGNATURE)
        self.assertEqual(created['revoked_at'], '2026-10-06T10:30:15Z')
        for key, value in SIGNATURE.items():
            if key != 'revoked_at':
                self.assertEqual(created[key], value)
        self.assertEqual(created['term_status'], 'valid')
        self.assertEqual(created['ep_state'], SIGNATURE['ep_state'])
        self.assertTrue(created['created_at'].endswith('Z'))
        self.assertEqual(self.client.get(self.endpoint('signatures')).json(), [created])
        self.assertEqual(self.client.get(self.endpoint('signatures') + f"/{created['id']}").json(), created)

    def test_power_round_trip_all_fields_and_multiline_permissions(self):
        created = self.create('powers-of-attorney', POWER)
        for key, value in POWER.items():
            self.assertEqual(created[key], value)
        self.assertEqual(self.client.get(self.endpoint('powers-of-attorney')).json(), [created])
        changed = self.client.put(self.endpoint('powers-of-attorney') + f"/{created['id']}", json={'permissions': POWER['permissions'] + '\nНовое разрешение', 'edo_identifier': None})
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertIsNone(changed.json()['edo_identifier'])
        self.assertEqual(changed.json()['power_number'], '000045')
        self.assertEqual(changed.json()['created_at'], created['created_at'])

    def test_partial_date_updates_and_required_nulls_are_rejected_without_changes(self):
        for kind, payload, required in (
            ('signatures', SIGNATURE, ['company_name', 'full_name', 'valid_from', 'valid_to']),
            ('powers-of-attorney', POWER, ['power_number', 'grantor_name', 'representative_full_name', 'valid_from', 'valid_to']),
        ):
            created = self.create(kind, payload)
            path = self.endpoint(kind) + f"/{created['id']}"
            for changes in [{'valid_to': '2025-01-01'}, {'valid_from': '2028-01-01'}] + [{key: None} for key in required]:
                with self.subTest(kind=kind, changes=changes):
                    response = self.client.put(path, json=changes)
                    self.assertEqual(response.status_code, 422, response.text)
                    self.assertEqual(self.client.get(path).json(), created)

    def test_blank_optional_fields_normalize_and_blank_required_text_is_rejected(self):
        created = self.create('signatures', {**SIGNATURE, 'inn': ' 0012345678 ', 'position': '  ', 'email': ''})
        self.assertEqual(created['inn'], '0012345678')
        self.assertIsNone(created['position'])
        self.assertIsNone(created['email'])
        response = self.client.post(self.endpoint('signatures'), json={**SIGNATURE, 'full_name': '   '})
        self.assertEqual(response.status_code, 422)
        path = self.endpoint('signatures') + f"/{created['id']}"
        cleared = self.client.put(path, json={'snils': '', 'serial_number': ' '})
        self.assertEqual(cleared.status_code, 200, cleared.text)
        self.assertIsNone(cleared.json()['snils'])
        self.assertIsNone(cleared.json()['serial_number'])

    def test_archive_restore_preserves_data_and_blocks_editing(self):
        for kind, payload in (('signatures', SIGNATURE), ('powers-of-attorney', POWER)):
            created = self.create(kind, payload)
            path = self.endpoint(kind) + f"/{created['id']}"
            self.assertEqual(self.client.delete(path).status_code, 204)
            self.assertEqual(self.client.get(self.endpoint(kind)).json(), [])
            archived = self.client.get(path).json()
            self.assertTrue(archived['is_archived'])
            self.assertTrue(archived['archived_at'].endswith('Z'))
            self.assertEqual(self.client.get(self.endpoint(kind), params={'archived': True}).json(), [archived])
            self.assertEqual(self.client.delete(path).status_code, 204)
            self.assertEqual(self.client.get(path).json()['archived_at'], archived['archived_at'])
            self.assertEqual(self.client.put(path, json={}).status_code, 409)
            restored = self.client.post(path + '/restore').json()
            self.assertFalse(restored['is_archived'])
            self.assertIsNone(restored['archived_at'])
            self.assertEqual(restored['created_at'], created['created_at'])
            for key in payload:
                self.assertEqual(restored[key], created[key])
            self.assertEqual(self.client.get(self.endpoint(kind), params={'archived': True}).json(), [])

    def test_invalid_email_naive_revocation_and_unknown_fields_are_rejected(self):
        for changes in (
            {'email': 'broken'}, {'revoked_at': '2026-10-06T14:30:15'},
            {'valid_to': '2025-01-01'}, {'is_archived': True}, {'inn': 12345678},
            {'created_at': '2025-01-01'}, {'fingerprint': 'a' * 513},
        ):
            with self.subTest(changes=changes):
                response = self.client.post(self.endpoint('signatures'), json={**SIGNATURE, **changes})
                self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.client.get(self.endpoint('signatures')).json(), [])

    def test_date_badges_are_inclusive_and_do_not_overwrite_source_state(self):
        for valid_from, valid_to, expected, days in (
            ('2026-10-07', '2026-11-01', 'not_started', 26),
            ('2026-01-01', '2026-11-06', 'valid', 31),
            ('2026-01-01', '2026-11-05', 'expiring', 30),
            ('2026-10-06', '2026-10-06', 'expiring', 0),
            ('2026-01-01', '2026-10-05', 'expired', -1),
        ):
            with self.subTest(expected=expected, valid_to=valid_to):
                created = self.create('signatures', {**SIGNATURE, 'valid_from': valid_from, 'valid_to': valid_to})
                self.assertEqual(created['term_status'], expected)
                self.assertEqual(created['days_left'], days)
                self.assertEqual(created['ep_state'], SIGNATURE['ep_state'])

    def test_all_routes_require_authentication(self):
        self.app.dependency_overrides.pop(get_current_user)
        for kind, payload in (('signatures', SIGNATURE), ('powers-of-attorney', POWER)):
            base = self.endpoint(kind)
            for method, url, data in (
                ('get', base, None), ('post', base, payload), ('get', base + '/1', None),
                ('put', base + '/1', {}), ('delete', base + '/1', None), ('post', base + '/1/restore', None),
            ):
                self.assertEqual(self.client.request(method, url, json=data).status_code, 401)

    def test_missing_records_return_404_for_each_operation(self):
        for kind in ('signatures', 'powers-of-attorney'):
            path = self.endpoint(kind) + '/999'
            for method, url, data in (('get', path, None), ('put', path, {}), ('delete', path, None), ('post', path + '/restore', None)):
                self.assertEqual(self.client.request(method, url, json=data).status_code, 404)

    def test_openapi_contains_all_user_fields_for_both_entities(self):
        schemas = self.app.openapi()['components']['schemas']
        self.assertTrue(set(SIGNATURE).issubset(schemas['SignatureCreate']['properties']))
        self.assertTrue(set(POWER).issubset(schemas['PowerOfAttorneyCreate']['properties']))


class DigitalDocumentsStartupTests(unittest.TestCase):
    def test_existing_database_adds_tables_idempotently_and_preserves_equipment(self):
        backend = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / 'existing.db'
            engine = create_engine('sqlite:///' + str(filename))
            Base.metadata.create_all(engine)
            with sessionmaker(bind=engine)() as db:
                db.add(Device(manufacturer='Kyocera', model='Keep printer', device_type=DeviceType.printer, inventory_number='1-00167'))
                db.commit()
            engine.dispose()
            with sqlite3.connect(filename) as db:
                db.execute('DROP TABLE electronic_signatures')
                db.execute('DROP TABLE machine_readable_powers_of_attorney')
            environment = {**os.environ, 'DATABASE_URL': 'sqlite:///' + str(filename), 'PHOTO_DIRECTORY': str(Path(directory) / 'photos')}
            script = "import main; from database import SessionLocal; from models import ElectronicSignature; from datetime import date; db=SessionLocal(); db.add(ElectronicSignature(company_name='Keep company',full_name='Keep holder',valid_from=date(2026,1,1),valid_to=date(2027,1,1))); db.commit()"
            subprocess.run([sys.executable, '-c', script], cwd=backend, env=environment, check=True, capture_output=True, timeout=30)
            subprocess.run([sys.executable, '-c', 'import main'], cwd=backend, env=environment, check=True, capture_output=True, timeout=30)
            with sqlite3.connect(filename) as db:
                self.assertEqual(db.execute('SELECT inventory_number,model FROM devices').fetchall(), [('1-00167', 'Keep printer')])
                self.assertEqual(db.execute('SELECT company_name FROM electronic_signatures').fetchall(), [('Keep company',)])
                self.assertEqual(db.execute('SELECT count(*) FROM machine_readable_powers_of_attorney').fetchone(), (0,))
                self.assertEqual(db.execute('PRAGMA quick_check').fetchone(), ('ok',))
