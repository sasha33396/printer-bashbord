import json
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
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, get_db
from models import Device, DeviceType, EquipmentEvent, OcsAssetLink, WarehouseItem, Workplace, WorkplaceAssetAssignment
from photo_storage import equipment_photo_key
from reset_inventory_numbers import run
from routers import devices, inventory, warehouse, workplaces
from routers.auth import get_current_user
from schema_migrations import allow_empty_device_inventory


BACKEND = Path(__file__).resolve().parents[1]
PNG = b"\x89PNG\r\n\x1a\n" + b"test photo content"


class ManualInventoryApiTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name) / "photos"
        self.photo_patch = patch("photo_storage.PHOTO_ROOT", self.root)
        self.photo_patch.start()
        self.addCleanup(self.photo_patch.stop)
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        app = FastAPI()
        for router, prefix in ((devices.router, "devices"), (warehouse.router, "warehouse"),
                               (workplaces.router, "workplaces"), (inventory.router, "inventory")):
            app.include_router(router, prefix="/api/" + prefix)
        def db_override():
            with self.sessions() as db:
                yield db
        app.dependency_overrides[get_db] = db_override
        app.dependency_overrides[get_current_user] = lambda: {"username": "test-manual"}
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def create_item(self, **changes):
        payload = {"name": "Unlabelled PC", "category": "Компьютеры", "tracking_type": "asset", **changes}
        response = self.client.post("/api/warehouse/items", json=payload)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def create_device(self, **changes):
        response = self.client.post("/api/devices", json={"manufacturer": "Kyocera", "model": "M2040dn", "device_type": "mfc", **changes})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_multiple_unnumbered_cards_and_manual_global_uniqueness(self):
        items = [self.create_item(), self.create_item()]
        devices_created = [self.create_device(), self.create_device()]
        self.assertTrue(all(item["inventory_number"] is None for item in items + devices_created))
        response = self.client.put(f"/api/warehouse/items/{items[0]['id']}", json={"inventory_number": "1-00001"})
        self.assertEqual(response.status_code, 200, response.text)
        duplicate = self.client.put(f"/api/devices/{devices_created[0]['id']}", json={"inventory_number": "1-00001"})
        self.assertEqual(duplicate.status_code, 409)
        cleared = self.client.put(f"/api/warehouse/items/{items[0]['id']}", json={"inventory_number": ""})
        self.assertIsNone(cleared.json()["inventory_number"])
        assigned = self.client.put(f"/api/devices/{devices_created[0]['id']}", json={"inventory_number": "1-00001"})
        self.assertEqual(assigned.status_code, 200)
        self.assertEqual(self.client.get("/api/inventory/lookup/1-00001").json()["entity_type"], "device")
        self.assertEqual(self.client.get("/api/devices").status_code, 200)

    def test_large_photos_upload_and_round_trip_for_equipment_and_devices(self):
        payload = PNG + b'\x00' * (2 * 1024 * 1024)
        item = self.create_item()
        device = self.create_device()
        for path in (f"/api/warehouse/items/{item['id']}", f"/api/devices/{device['id']}"):
            with self.subTest(path=path):
                response = self.client.post(path + '/photos', files={'files': ('rack.png', payload, 'image/png')})
                self.assertEqual(response.status_code, 201, response.text)
                self.assertEqual(response.json()[0]['size'], len(payload))
                filename = response.json()[0]['filename']
                self.assertEqual(self.client.get(path + '/photos/' + filename).content, payload)

    def test_excel_import_leaves_missing_physical_number_empty(self):
        import io
        import openpyxl
        workbook = openpyxl.Workbook()
        workbook.active.append(devices._EXPECTED_HEADERS)
        workbook.active.append([None, "EXCEL-SERIAL", "Kyocera", "M2040dn", "mfc"] + [None] * 7)
        content = io.BytesIO()
        workbook.save(content)
        response = self.client.post("/api/devices/import", files={"file": ("devices.xlsx", content.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["created"], 1)
        with self.sessions() as db:
            self.assertIsNone(db.query(Device).one().inventory_number)

    def test_photo_and_workplace_photo_survive_assignment_clear_and_number_reuse(self):
        item = self.create_item()
        item_path = f"/api/warehouse/items/{item['id']}"
        uploaded = self.client.post(item_path + "/photos", files={"files": ("photo.png", PNG, "image/png")})
        self.assertEqual(uploaded.status_code, 201, uploaded.text)
        filename = uploaded.json()[0]["filename"]
        workplace = self.client.post("/api/workplaces", json={"name": "TEST-WP"}).json()
        assigned = self.client.post(f"/api/workplaces/{workplace['id']}/assignments", json={"item_id": item["id"], "assigned_at": "2026-10-06"})
        self.assertEqual(assigned.status_code, 201, assigned.text)
        selected = self.client.put(f"/api/workplaces/{workplace['id']}/photo", json={"item_id": item["id"], "filename": filename})
        self.assertEqual(selected.status_code, 200, selected.text)
        for number in ("1-00002", None, "1-00003", None):
            updated = self.client.put(item_path, json={"inventory_number": number})
            self.assertEqual(updated.status_code, 200, updated.text)
            listing = self.client.get(item_path + "/photos").json()
            content = self.client.get(item_path + "/photos/" + listing[0]["filename"])
            self.assertEqual(content.content, PNG)
            self.assertEqual(self.client.get(f"/api/workplaces/{workplace['id']}/photo").content, PNG)
        replacement = self.create_item(inventory_number="1-00002")
        self.assertEqual(self.client.get(f"/api/warehouse/items/{replacement['id']}/photos").json(), [])
        with self.sessions() as db:
            self.assertEqual(db.query(WorkplaceAssetAssignment).count(), 1)
            self.assertEqual(db.query(EquipmentEvent).filter_by(event_type="updated").count(), 4)

    def test_device_photos_without_number_and_later_number_edit(self):
        device = self.create_device()
        path = f"/api/devices/{device['id']}"
        photo = self.client.post(path + "/photos", files={"files": ("photo.png", PNG, "image/png")})
        self.assertEqual(photo.status_code, 201, photo.text)
        for number in ("1-00004", None):
            response = self.client.put(path, json={"inventory_number": number})
            self.assertEqual(response.status_code, 200, response.text)
            filename = self.client.get(path + "/photos").json()[0]["filename"]
            self.assertEqual(self.client.get(path + "/photos/" + filename).content, PNG)

    def test_archive_excludes_unnumbered_devices_without_crashing(self):
        self.create_device()
        self.create_device(inventory_number="1-00005")
        response = self.client.get("/api/inventory/archive")
        self.assertEqual(response.status_code, 200, response.text)
        import io
        import zipfile
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            self.assertEqual(archive.namelist(), ["1-00005/1-00005.txt"])


class ExistingDatabaseMigrationTests(unittest.TestCase):
    def test_not_null_migration_preserves_rows_children_indexes_triggers_and_extra_columns(self):
        engine = create_engine("sqlite://")
        self.addCleanup(engine.dispose)
        @event.listens_for(engine, "connect")
        def enable_fk(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")
        with engine.begin() as db:
            db.exec_driver_sql("CREATE TABLE devices (id INTEGER PRIMARY KEY, inventory_number VARCHAR(100) NOT NULL UNIQUE, serial_number TEXT UNIQUE, legacy_value TEXT)")
            db.exec_driver_sql("CREATE INDEX test_serial_index ON devices(serial_number)")
            db.exec_driver_sql("CREATE TABLE repairs (id INTEGER PRIMARY KEY, device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE)")
            db.exec_driver_sql("CREATE TABLE edits (device_id INTEGER)")
            db.exec_driver_sql("CREATE TRIGGER test_device_edit AFTER UPDATE ON devices BEGIN INSERT INTO edits VALUES (NEW.id); END")
            db.exec_driver_sql("INSERT INTO devices VALUES (42, '1-00003', 'SERIAL', 'keep extra column')")
            db.exec_driver_sql("INSERT INTO repairs VALUES (1, 42)")
        allow_empty_device_inventory(engine)
        allow_empty_device_inventory(engine)
        with engine.begin() as db:
            self.assertEqual(db.exec_driver_sql("SELECT * FROM devices").one(), (42, "1-00003", "SERIAL", "keep extra column"))
            self.assertEqual(db.exec_driver_sql("SELECT device_id FROM repairs").scalar(), 42)
            self.assertEqual(db.exec_driver_sql("PRAGMA foreign_keys").scalar(), 1)
            self.assertEqual(db.exec_driver_sql("PRAGMA foreign_key_check").all(), [])
            db.exec_driver_sql("UPDATE devices SET inventory_number=NULL WHERE id=42")
            db.exec_driver_sql("INSERT INTO devices VALUES (43,NULL,'SERIAL2','new')")
            self.assertEqual(db.exec_driver_sql("SELECT device_id FROM edits").scalar(), 42)
            indexes = {row[1] for row in db.exec_driver_sql("PRAGMA index_list(devices)")}
            self.assertIn("test_serial_index", indexes)

    def test_actual_application_startup_never_regenerates_numbers(self):
        import os
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / "test.db"
            environment = {**os.environ, "DATABASE_URL": "sqlite:///" + str(filename),
                           "PHOTO_DIRECTORY": str(Path(directory) / "photos")}
            script = "import main; from database import SessionLocal; from models import Device,DeviceType; d=SessionLocal(); d.add_all([Device(manufacturer='A',model='B',device_type=DeviceType.printer),Device(manufacturer='A',model='C',device_type=DeviceType.printer,inventory_number='1-00167')]); d.commit()"
            subprocess.run([sys.executable, "-c", script], cwd=BACKEND, env=environment, check=True, capture_output=True, timeout=30)
            subprocess.run([sys.executable, "-c", "import main"], cwd=BACKEND, env=environment, check=True, capture_output=True, timeout=30)
            with sqlite3.connect(filename) as db:
                self.assertEqual(db.execute("SELECT inventory_number FROM devices ORDER BY id").fetchall(), [(None,), ("1-00167",)])


class InventoryCleanupTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.base = Path(self.directory.name)
        self.filename = self.base / "test.db"
        self.root = self.base / "photos"
        self.keep = json.loads((BACKEND / "inventory_numbers_keep.json").read_text(encoding="utf-8"))
        engine = create_engine("sqlite:///" + str(self.filename))
        Base.metadata.create_all(engine)
        with sessionmaker(bind=engine)() as db:
            for entry in self.keep:
                db.add(WarehouseItem(**entry, tracking_type="asset"))
            extra = WarehouseItem(name="CLEAR PC", category="Компьютеры", inventory_number="1-00888", tracking_type="asset")
            device = Device(manufacturer="Kyocera", model="M2040dn", device_type=DeviceType.mfc, inventory_number="1-00889")
            workplace = Workplace(name="KEEP WORKPLACE")
            db.add_all([extra, device, workplace])
            db.flush()
            db.add(WorkplaceAssetAssignment(item_id=extra.id, workplace_id=workplace.id, assigned_at=date(2026, 10, 6), inventory_number="1-00888"))
            db.add(OcsAssetLink(source_key="main", asset_kind="computer", external_id="999", item_id=extra.id, workplace_id=workplace.id))
            self.item_id, self.device_id = extra.id, device.id
            db.commit()
        engine.dispose()
        for number in ("1-00888", "1-00889", "1-00003"):
            album = self.root / number
            album.mkdir(parents=True)
            (album / (number + "_0001.png")).write_bytes(PNG)

    def test_preview_is_read_only_apply_keeps_eleven_cards_and_preserves_links_and_photos(self):
        preview = run(self.filename, self.root, self.keep, self.base / "preview")
        self.assertEqual(preview["totals"], {"retained": 11, "cleared": 2, "photo_albums_moved": 2})
        self.assertTrue((self.root / "1-00888").exists())
        applied = run(self.filename, self.root, self.keep, self.base / "apply", apply=True)
        self.assertEqual(applied["status"], "applied")
        with sqlite3.connect(self.filename) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM warehouse_items WHERE inventory_number IS NOT NULL").fetchone()[0], 11)
            self.assertIsNone(db.execute("SELECT inventory_number FROM devices").fetchone()[0])
            self.assertEqual(db.execute("SELECT inventory_number FROM workplace_asset_assignments").fetchone()[0], "1-00888")
            self.assertEqual(db.execute("SELECT item_id FROM ocs_asset_links").fetchone()[0], self.item_id)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM equipment_events WHERE actor='inventory-cleanup'").fetchone()[0], 2)
        with sqlite3.connect(self.base / "apply/before.db") as backup:
            self.assertEqual(backup.execute("SELECT inventory_number FROM devices").fetchone()[0], "1-00889")
        self.assertTrue((self.base / "apply/photos-before.tar.gz").is_file())
        for kind, ident, old_number in (("warehouse_item", self.item_id, "1-00888"), ("device", self.device_id, "1-00889")):
            folder = self.root / equipment_photo_key(kind, ident, None)
            self.assertEqual((folder / (old_number + "_0001.png")).read_bytes(), PNG)
            self.assertFalse((self.root / old_number).exists())
        self.assertTrue((self.root / "1-00003").exists())
        repeated = run(self.filename, self.root, self.keep, self.base / "repeat", apply=True)
        self.assertEqual(repeated["totals"]["cleared"], 0)

    def test_keep_serial_mismatch_refuses_all_changes(self):
        self.keep[0]["serial_number"] = "WRONG"
        with self.assertRaisesRegex(ValueError, "serial differs"):
            run(self.filename, self.root, self.keep, self.base / "failed", apply=True)
        with sqlite3.connect(self.filename) as db:
            self.assertEqual(db.execute("SELECT inventory_number FROM devices").fetchone()[0], "1-00889")
        self.assertTrue((self.root / "1-00888").exists())
        self.assertFalse((self.base / "failed/before.db").exists())

    def test_database_error_rolls_back_numbers_and_album_moves(self):
        with sqlite3.connect(self.filename) as db:
            db.execute("CREATE TRIGGER fail_clear BEFORE UPDATE ON warehouse_items WHEN NEW.inventory_number IS NULL BEGIN SELECT RAISE(ABORT, 'test failure'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            run(self.filename, self.root, self.keep, self.base / "failed", apply=True)
        with sqlite3.connect(self.filename) as db:
            self.assertEqual(db.execute("SELECT inventory_number FROM devices").fetchone()[0], "1-00889")
            self.assertEqual(db.execute("SELECT inventory_number FROM warehouse_items WHERE id=?", (self.item_id,)).fetchone()[0], "1-00888")
            self.assertEqual(db.execute("SELECT COUNT(*) FROM equipment_events").fetchone()[0], 0)
        self.assertTrue((self.root / "1-00888").exists())
        self.assertTrue((self.root / "1-00889").exists())
