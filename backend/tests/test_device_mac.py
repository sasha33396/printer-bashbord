import io
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

import openpyxl
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import Device, DeviceType, EquipmentEvent
from routers import devices, inventory
import test_manual_inventory as fixtures


class DeviceMacApiTests(unittest.TestCase):
    setUp = fixtures.ManualInventoryApiTests.setUp
    create_device = fixtures.ManualInventoryApiTests.create_device

    def test_mac_create_edit_read_clear_and_history_preserve_other_fields(self):
        device = self.create_device(mac_address=' aa-bb-cc-dd-ee-ff ', ip_address='192.168.1.10')
        self.assertEqual(device['mac_address'], 'AA:BB:CC:DD:EE:FF')
        path = f"/api/devices/{device['id']}"
        with self.sessions() as db:
            record = db.get(Device, device['id'])
            record.page_counter = 1234
            record.counter_checked_at = '2026-10-09T12:00:00Z'
            db.commit()
        for mac in ['001122334455', '0011.2233.4455', '00-11-22-33-44-55']:
            response = self.client.put(path, json={'mac_address': mac})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['mac_address'], '00:11:22:33:44:55')
            self.assertEqual(response.json()['ip_address'], '192.168.1.10')
            self.assertEqual(response.json()['page_counter'], 1234)
        changed = self.client.put(path, json={'location': '204'}).json()
        self.assertEqual(changed['mac_address'], '00:11:22:33:44:55')
        self.assertEqual(self.client.get('/api/devices').json()[0]['mac_address'], changed['mac_address'])
        for blank in ['   ', None]:
            cleared = self.client.put(path, json={'mac_address': blank})
            self.assertEqual(cleared.status_code, 200, cleared.text)
            self.assertIsNone(cleared.json()['mac_address'])
        with self.sessions() as db:
            events = db.query(EquipmentEvent).filter_by(entity_type='device', event_type='updated').all()
            mac_changes = [json.loads(event.changes_json)['MAC-адрес'] for event in events if 'MAC-адрес' in json.loads(event.changes_json)]
            self.assertEqual(mac_changes, [
                {'before': 'AA:BB:CC:DD:EE:FF', 'after': '00:11:22:33:44:55'},
                {'before': '00:11:22:33:44:55', 'after': None},
            ])

    def test_optional_mac_and_invalid_mac_are_validated_without_writes(self):
        device = self.create_device()
        self.assertIsNone(device['mac_address'])
        path = f"/api/devices/{device['id']}"
        for bad in ['GG:BB:CC:DD:EE:FF', 'AA:BB:CC', 'http://AA:BB:CC:DD:EE:FF', 123]:
            response = self.client.put(path, json={'mac_address': bad, 'location': 'should not change'})
            self.assertEqual(response.status_code, 422, response.text)
            self.assertEqual(self.client.get(path).json(), device)
            response = self.client.post('/api/devices', json={'manufacturer': 'Test', 'model': 'Test', 'device_type': 'printer', 'mac_address': bad})
            self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(len(self.client.get('/api/devices').json()), 1)

    def workbook(self, headers, rows):
        book = openpyxl.Workbook()
        book.active.append(headers)
        for row in rows:
            book.active.append(row)
        buffer = io.BytesIO()
        book.save(buffer)
        book.close()
        return buffer.getvalue()

    def test_excel_import_accepts_optional_mac_and_old_templates(self):
        base = [None, None, 'Kyocera', 'M2040dn', 'МФУ', None, None, None, None, None, 'active', None]
        headers = devices._EXPECTED_HEADERS + ['IP-адрес', 'MAC-адрес']
        contents = self.workbook(headers, [base + ['192.168.1.10', 'aa-bb-cc-dd-ee-ff'], base + [None, 'bad'], base + [None, None]])
        response = self.client.post('/api/devices/import', files={'file': ('devices.xlsx', contents)})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['created'], 2)
        self.assertEqual(response.json()['skipped'], 1)
        self.assertIn('MAC-адрес', response.json()['errors'][0])
        self.assertEqual([row['mac_address'] for row in self.client.get('/api/devices').json()], ['AA:BB:CC:DD:EE:FF', None])
        old_file = self.workbook(devices._EXPECTED_HEADERS, [base])
        response = self.client.post('/api/devices/import', files={'file': ('old.xlsx', old_file)})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['created'], 1)

    def test_inventory_archive_preserves_mac_and_old_archives_do_not_clear_it(self):
        device = self.create_device(inventory_number='1-00001', mac_address='aa-bb-cc-dd-ee-ff')
        archive = self.client.get('/api/inventory/archive')
        self.assertEqual(archive.status_code, 200, archive.text[:100])
        with zipfile.ZipFile(io.BytesIO(archive.content)) as source:
            text = source.read('1-00001/1-00001.txt')
        self.assertIn('MAC-адрес: AA:BB:CC:DD:EE:FF', text.decode())
        path = f"/api/devices/{device['id']}"
        self.client.put(path, json={'mac_address': None})
        response = self.client.post('/api/inventory/archive', files={'file': ('archive.zip', archive.content)})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['errors'], [])
        self.assertEqual(self.client.get(path).json()['mac_address'], 'AA:BB:CC:DD:EE:FF')
        card = inventory._card_from_text(text)
        card['data'].pop('mac_address')
        legacy = io.BytesIO()
        with zipfile.ZipFile(legacy, 'w') as target:
            target.writestr('1-00001/1-00001.txt', inventory._card_text(card))
        response = self.client.post('/api/inventory/archive', files={'file': ('legacy.zip', legacy.getvalue())})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['errors'], [])
        self.assertEqual(self.client.get(path).json()['mac_address'], 'AA:BB:CC:DD:EE:FF')


class DeviceMacMigrationTests(unittest.TestCase):
    def test_real_startup_adds_mac_to_old_database_and_preserves_it_on_restart(self):
        backend = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / 'existing.db'
            engine = create_engine('sqlite:///' + str(filename))
            Base.metadata.create_all(engine)
            with sessionmaker(bind=engine)() as db:
                db.add(Device(manufacturer='Kyocera', model='Keep model', device_type=DeviceType.printer,
                              inventory_number='1-00001', ip_address='192.168.1.10', page_counter=1234))
                db.commit()
            engine.dispose()
            with sqlite3.connect(filename) as db:
                db.execute('ALTER TABLE devices DROP COLUMN mac_address')
            environment = {**os.environ, 'DATABASE_URL': 'sqlite:///' + str(filename), 'PHOTO_DIRECTORY': str(Path(directory) / 'photos')}
            subprocess.run([sys.executable, '-c', 'import main'], cwd=backend, env=environment, check=True, capture_output=True, timeout=30)
            with sqlite3.connect(filename) as db:
                self.assertEqual(db.execute('SELECT inventory_number,model,ip_address,page_counter,mac_address FROM devices').fetchone(),
                                 ('1-00001', 'Keep model', '192.168.1.10', 1234, None))
                db.execute("UPDATE devices SET mac_address='AA:BB:CC:DD:EE:FF'")
            subprocess.run([sys.executable, '-c', 'import main'], cwd=backend, env=environment, check=True, capture_output=True, timeout=30)
            with sqlite3.connect(filename) as db:
                self.assertEqual(db.execute('SELECT mac_address FROM devices').fetchone(), ('AA:BB:CC:DD:EE:FF',))
                self.assertEqual(db.execute('PRAGMA quick_check').fetchone(), ('ok',))
