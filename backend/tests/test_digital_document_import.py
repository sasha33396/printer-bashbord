import unittest
from datetime import datetime
from io import BytesIO
from zipfile import ZipFile, ZIP_DEFLATED

from openpyxl import Workbook
from sqlalchemy.exc import IntegrityError
from unittest.mock import patch

from digital_document_import import FIELDS, MAX_FILE_BYTES
from models import ElectronicSignature, MachineReadablePowerOfAttorney
import test_digital_documents as fixtures

SIGNATURE, POWER = fixtures.SIGNATURE, fixtures.POWER


class DigitalDocumentImportTests(unittest.TestCase):
    setUp = fixtures.DigitalDocumentsApiTests.setUp
    endpoint = fixtures.DigitalDocumentsApiTests.endpoint
    create = fixtures.DigitalDocumentsApiTests.create

    def workbook(self, signatures=None, powers=None, change=None):
        book = Workbook()
        book.remove(book.active)
        for kind, name, data in [('ecp', 'ЭЦП', signatures if signatures is not None else [SIGNATURE]),
                                  ('mchd', 'МЧД', powers if powers is not None else [POWER])]:
            sheet = book.create_sheet(name)
            sheet.append([label for _, label in FIELDS[kind]])
            for record in data:
                sheet.append([record.get(key) for key, _ in FIELDS[kind]])
        if change:
            change(book)
        buffer = BytesIO()
        book.save(buffer)
        book.close()
        return buffer.getvalue()

    def upload(self, contents, apply=False, filename='registers.xlsx'):
        return self.client.post('/api/digital-documents/import-xlsx', params={'apply': apply},
                                files={'file': (filename, contents, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')})

    def assert_empty(self):
        self.assertEqual(self.client.get(self.endpoint('signatures')).json(), [])
        self.assertEqual(self.client.get(self.endpoint('powers-of-attorney')).json(), [])

    def test_preview_is_read_only_apply_imports_both_sheets_and_retry_skips_everything(self):
        file = self.workbook()
        preview = self.upload(file)
        self.assertEqual(preview.status_code, 200, preview.text)
        self.assertEqual(preview.json()['totals'], {'new': 2, 'unchanged': 0, 'error': 0, 'conflict': 0})
        self.assertFalse(preview.json()['applied'])
        self.assert_empty()
        report = self.upload(file, apply=True).json()
        self.assertTrue(report['applied'])
        signature = self.client.get(self.endpoint('signatures')).json()[0]
        power = self.client.get(self.endpoint('powers-of-attorney')).json()[0]
        for key, value in SIGNATURE.items():
            self.assertEqual(signature[key], '2026-10-06T10:30:15Z' if key == 'revoked_at' else value)
        for key, value in POWER.items():
            self.assertEqual(power[key], value)
        retried = self.upload(file, apply=True).json()
        self.assertTrue(retried['applied'])
        self.assertEqual(retried['totals']['new'], 0)
        self.assertEqual(retried['totals']['unchanged'], 2)
        self.assertEqual(len(self.client.get(self.endpoint('signatures')).json()), 1)

    def test_headers_any_order_title_blank_cells_and_optional_columns(self):
        def change(book):
            sheet = book['ЭЦП']
            book.remove(sheet)
            sheet = book.create_sheet(' эцп ')
            sheet.append(['Заголовок реестра'])
            sheet.append(['Лишний столбец', ' Действителен\nпо ', 'ФИО', 'Действителен c', 'Название\u00a0компании'])
            sheet.append(['ignore', '01.01.2027', 'Иванов Иван', '01.01.2026', 'ООО Компания'])
            sheet.append([None, None, None, None, None])
        report = self.upload(self.workbook(powers=[], change=change), apply=True).json()
        self.assertTrue(report['applied'])
        self.assertEqual(report['totals']['new'], 1)
        self.assertEqual(report['rows'][0]['row'], 3)
        self.assertTrue(report['warnings'])
        record = self.client.get(self.endpoint('signatures')).json()[0]
        self.assertIsNone(record['inn'])
        self.assertEqual(record['valid_to'], '2027-01-01')

    def test_excel_dates_numeric_masks_and_local_revocation_time(self):
        def change(book):
            sheet = book['ЭЦП']
            sheet['B2'] = 12345678
            sheet['B2'].number_format = '0000000000'
            sheet['J2'] = datetime(2026, 1, 1)
            sheet['K2'] = 46388  # 2027-01-01 in Excel's default epoch.
            sheet['M2'] = datetime(2026, 10, 6, 14, 30, 15)
            sheet['O2'] = 123
            sheet['O2'].number_format = '00000000'
        report = self.upload(self.workbook(change=change), apply=True).json()
        self.assertTrue(report['applied'], report)
        record = self.client.get(self.endpoint('signatures')).json()[0]
        self.assertEqual(record['inn'], '0012345678')
        self.assertEqual(record['serial_number'], '00000123')
        self.assertEqual(record['valid_to'], '2027-01-01')
        self.assertEqual(record['revoked_at'], '2026-10-06T10:30:15Z')

    def test_error_in_second_sheet_blocks_whole_file_with_sheet_and_row(self):
        file = self.workbook(powers=[{**POWER, 'valid_to': '2025-01-01'}])
        for apply in [False, True]:
            report = self.upload(file, apply=apply).json()
            self.assertFalse(report['can_apply'])
            self.assertFalse(report['applied'])
            self.assertEqual(report['totals']['error'], 1)
            issue = report['rows'][1]
            self.assertEqual((issue['sheet'], issue['row']), ('МЧД', 2))
            self.assertIn('Дата окончания', issue['message'])
            self.assert_empty()

    def test_invalid_values_formulas_long_numeric_identifiers_and_blank_required_cells(self):
        for field, value in [('fingerprint', 12345678901234567890), ('inn', 123.5), ('email', 'broken'),
                             ('full_name', None), ('valid_from', '=TODAY()'), ('valid_to', 'not a date')]:
            with self.subTest(field=field):
                report = self.upload(self.workbook(signatures=[{**SIGNATURE, field: value}]), apply=True).json()
                self.assertFalse(report['can_apply'], report)
                self.assertEqual(report['totals']['error'], 1)
                self.assertIn(dict(FIELDS['ecp'])[field], report['rows'][0]['message'])
                self.assert_empty()

    def test_duplicate_rows_in_file_are_added_once(self):
        report = self.upload(self.workbook(signatures=[SIGNATURE, SIGNATURE], powers=[POWER, POWER]), apply=True).json()
        self.assertTrue(report['applied'])
        self.assertEqual(report['totals']['new'], 2)
        self.assertEqual(report['totals']['unchanged'], 2)
        self.assertIn('Повтор строки 2', report['rows'][1]['message'])

    def test_same_identity_different_data_blocks_without_overwriting(self):
        record = self.create('signatures', SIGNATURE)
        changed = {**SIGNATURE, 'position': 'Новая должность'}
        file = self.workbook(signatures=[changed])
        report = self.upload(file, apply=True).json()
        self.assertFalse(report['applied'])
        self.assertEqual(report['totals']['conflict'], 1)
        self.assertEqual(report['rows'][0]['existing_id'], record['id'])
        self.assertEqual(self.client.get(self.endpoint('signatures')).json(), [record])
        self.assertEqual(self.client.get(self.endpoint('powers-of-attorney')).json(), [])

    def test_conflicting_duplicate_inside_file_blocks_everything(self):
        report = self.upload(self.workbook(signatures=[SIGNATURE, {**SIGNATURE, 'full_name': 'Другой владелец'}]), apply=True).json()
        self.assertFalse(report['applied'])
        self.assertEqual(report['totals']['conflict'], 1)
        self.assert_empty()

    def test_archived_records_are_skipped_without_restoring(self):
        record = self.create('signatures', SIGNATURE)
        self.client.delete(self.endpoint('signatures') + f"/{record['id']}")
        report = self.upload(self.workbook(), apply=True).json()
        self.assertTrue(report['applied'])
        self.assertEqual(report['totals']['unchanged'], 1)
        self.assertIn('в архиве', report['rows'][0]['message'])
        self.assertEqual(self.client.get(self.endpoint('signatures')).json(), [])
        self.assertEqual(len(self.client.get(self.endpoint('signatures'), params={'archived': True}).json()), 1)

    def test_power_number_is_not_globally_unique(self):
        second = {**POWER, 'grantor_inn': '9999999999', 'grantor_name': 'Другой доверитель',
                  'fns_identifier': 'other-fns', 'edo_identifier': 'other-edo'}
        report = self.upload(self.workbook(signatures=[], powers=[POWER, second]), apply=True).json()
        self.assertTrue(report['applied'], report)
        self.assertEqual(report['totals']['new'], 2)

    def test_apply_rechecks_database_after_preview(self):
        file = self.workbook()
        self.assertEqual(self.upload(file).json()['totals']['new'], 2)
        self.create('powers-of-attorney', {**POWER, 'permissions': 'Изменено вручную'})
        applied = self.upload(file, apply=True).json()
        self.assertFalse(applied['applied'])
        self.assertEqual(applied['totals']['conflict'], 1)
        self.assertEqual(self.client.get(self.endpoint('signatures')).json(), [])

    def test_insert_failure_rolls_back_first_sheet(self):
        original_flush = self.sessions.class_.flush
        def fail_on_power(db, *args, **kwargs):
            # Flush signature first, then fail second insert in the same transaction.
            signatures = [record for record in db.new if isinstance(record, ElectronicSignature)]
            if any(isinstance(record, MachineReadablePowerOfAttorney) for record in db.new):
                original_flush(db, objects=signatures)
                raise IntegrityError('forced', {}, Exception('forced'))
            return original_flush(db, *args, **kwargs)
        with patch.object(self.sessions.class_, 'flush', fail_on_power):
            with self.assertRaises(IntegrityError):
                self.upload(self.workbook(), apply=True)
        self.assert_empty()

    def test_invalid_file_missing_sheets_duplicate_headers_and_size_limit(self):
        cases = [(b'broken', 'register.xlsx'), (self.workbook(), 'register.xls'),
                 (b'x' * (MAX_FILE_BYTES + 1), 'register.xlsx'),
                 (self.workbook(change=lambda book: book.remove(book['МЧД'])), 'register.xlsx'),
                 (self.workbook(change=lambda book: setattr(book['ЭЦП']['B1'], 'value', 'Название компании')), 'register.xlsx'),
                 (self.workbook(signatures=[], powers=[]), 'register.xlsx')]
        for contents, filename in cases:
            with self.subTest(filename=filename, size=len(contents)):
                response = self.upload(contents, apply=True, filename=filename)
                self.assertEqual(response.status_code, 422, response.text)
                self.assertIsInstance(response.json()['detail'], str)
                self.assert_empty()

    def test_upload_requires_login(self):
        from routers.auth import get_current_user
        self.app.dependency_overrides.pop(get_current_user)
        self.assertEqual(self.upload(self.workbook(), apply=True).status_code, 401)

    def test_corrupted_sheet_xml_and_sparse_oversized_table_return_clear_errors(self):
        buffer = BytesIO()
        with ZipFile(BytesIO(self.workbook())) as source, ZipFile(buffer, 'w', ZIP_DEFLATED) as target:
            for name in source.namelist():
                contents = source.read(name)
                if name == 'xl/worksheets/sheet1.xml':
                    contents = contents.replace(b'</worksheet>', b'</invalid>')
                target.writestr(name, contents)
        oversized = self.workbook(change=lambda book: setattr(book['ЭЦП']['A10021'], 'value', 'Too many rows'))
        for contents in [buffer.getvalue(), oversized]:
            response = self.upload(contents, apply=True)
            self.assertEqual(response.status_code, 422, response.text)
            self.assertIsInstance(response.json()['detail'], str)
            self.assert_empty()

    def test_conflicting_identifiers_pointing_to_multiple_records_are_not_merged(self):
        first = self.create('signatures', SIGNATURE)
        second = self.create('signatures', {**SIGNATURE, 'fingerprint': 'other', 'serial_number': 'other'})
        report = self.upload(self.workbook(signatures=[{**SIGNATURE, 'serial_number': 'other'}]), apply=True).json()
        self.assertFalse(report['applied'])
        self.assertEqual(report['totals']['conflict'], 1)
        self.assertEqual(self.client.get(self.endpoint('signatures')).json(), [first, second])
