"""Validate the demo as a usable application dataset, including write flows."""
from datetime import date
from contextlib import closing
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from database import get_db, initialize_database
from models import Cartridge, Device, Workplace
from routers import analytics, cartridges, devices, digital_documents, employees, history, maps, orgs, repairs, warehouse, workplaces
from routers.auth import get_current_user
from seed_demo import build_demo, demo_info


AS_OF = date(2026, 10, 18)


class DemoDatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.directory.cleanup)
        cls.seed = Path(cls.directory.name) / "seed.db"
        build_demo(cls.seed, AS_OF)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "test.db"
        shutil.copyfile(self.seed, self.path)
        self.engine = create_engine("sqlite:///" + self.path.as_posix(), connect_args={"check_same_thread": False})
        self.addCleanup(self.engine.dispose)
        self.sessions = sessionmaker(bind=self.engine)
        app = FastAPI()
        for name, router in (("analytics", analytics), ("cartridges", cartridges), ("devices", devices),
                             ("digital-documents", digital_documents), ("employees", employees),
                             ("history", history), ("maps", maps), ("orgs", orgs),
                             ("repairs", repairs), ("warehouse", warehouse), ("workplaces", workplaces)):
            app.include_router(router.router, prefix=f"/api/{name}")

        def test_db():
            with self.sessions() as db:
                yield db

        app.dependency_overrides[get_db] = test_db
        app.dependency_overrides[get_current_user] = lambda: {"username": "demo-test"}
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def get(self, route):
        response = self.client.get("/api/" + route)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_seed_refuses_existing_files_and_reuses_only_demo(self):
        before = hashlib.sha256(self.path.read_bytes()).digest()
        with self.assertRaises(FileExistsError):
            build_demo(self.path, AS_OF)
        self.assertTrue(build_demo(self.path, AS_OF, if_missing=True)["reused"])
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).digest(), before)
        other = self.path.parent / "production.db"
        with closing(sqlite3.connect(other)) as db, db:
            db.execute("CREATE TABLE valuable_data (value TEXT)")
            db.execute("INSERT INTO valuable_data VALUES ('preserve me')")
        before = other.read_bytes()
        with self.assertRaises(ValueError):
            build_demo(other, AS_OF, if_missing=True)
        self.assertEqual(other.read_bytes(), before)

    def test_integrity_startup_migrations_and_domain_constraints(self):
        with patch("database.engine", self.engine):
            initialize_database()
            initialize_database()
        with self.engine.connect() as db:
            self.assertEqual(db.exec_driver_sql("PRAGMA integrity_check").scalar(), "ok")
            self.assertEqual(db.exec_driver_sql("PRAGMA foreign_key_check").all(), [])
            self.assertEqual(db.execute(text("SELECT COUNT(*) FROM (SELECT inventory_number FROM "
                "(SELECT inventory_number FROM devices UNION ALL SELECT inventory_number FROM warehouse_items) "
                "WHERE inventory_number IS NOT NULL GROUP BY inventory_number HAVING COUNT(*) > 1)")).scalar(), 0)
            self.assertEqual(db.execute(text("SELECT COUNT(*) FROM (SELECT item_id FROM workplace_asset_assignments "
                "WHERE ended_at IS NULL GROUP BY item_id HAVING COUNT(*) > 1)")).scalar(), 0)
        counts = json.loads(demo_info(self.path)["counts"])
        self.assertGreater(counts["equipment_events"], 100)
        self.assertEqual(counts["map_floors"], 3)
        items = self.get("warehouse/items")
        self.assertTrue(all(item["current_quantity"] >= 0 for item in items))
        self.assertTrue(any(item["current_quantity"] < item["min_quantity"] for item in items))

    def test_all_sections_and_cards_serialize_real_database(self):
        for route in ("orgs/branches", "orgs/departments", "employees", "devices", "repairs",
                      "warehouse/items", "warehouse/items?archived=true", "workplaces",
                      "workplaces?archived=true", "cartridges", "cartridges/operations", "history",
                      "analytics/summary", "analytics/costs", "maps/buildings", "maps/catalog"):
            with self.subTest(route=route):
                self.get(route)
        for row in self.get("devices"):
            self.get(f"devices/{row['id']}")
        for row in self.get("warehouse/items"):
            self.get(f"warehouse/items/{row['id']}")
        for row in self.get("workplaces"):
            self.get(f"workplaces/{row['id']}")
        for kind in ("signatures", "powers-of-attorney"):
            with patch("routers.digital_documents.register_today", return_value=AS_OF):
                rows = self.get("digital-documents/" + kind)
                self.assertEqual({row["term_status"] for row in rows},
                                 {"not_started", "valid", "expiring", "expired"})
                self.assertEqual(len(self.get("digital-documents/" + kind + "?archived=true")), 1)

    def test_map_inherits_asset_and_employee_location_and_can_save(self):
        with self.sessions() as db:
            workplace = db.query(Workplace).filter_by(name="ДЕМО-РМ-001").one()
            item_id = workplace.assignments[0].item_id
            employee_id = workplace.employee_id
        for kind, identifier in (("warehouse_item", item_id), ("employee", employee_id)):
            located = self.get(f"maps/locate/{kind}/{identifier}")
            self.assertTrue(located["placed"])
        for building in self.get("maps/buildings"):
            for brief in building["floors"]:
                floor = self.get(f"maps/floors/{brief['id']}")
                self.assertTrue(all(row["entity"]["available"] for row in floor["markers"]))
                document = {key: floor[key] for key in ("name", "width", "height", "revision", "shapes", "background_opacity")}
                document["markers"] = [{key: marker[key] for key in ("entity_type", "entity_id", "x", "y", "rotation")}
                                       for marker in floor["markers"]]
                response = self.client.put(f"/api/maps/floors/{floor['id']}", data={"document": json.dumps(document)})
                self.assertEqual(response.status_code, 200, response.text)

    def test_demo_cartridge_can_replace_installed_cartridge(self):
        with self.sessions() as db:
            incoming = db.query(Cartridge).filter_by(state="ready").first()
            outgoing = db.query(Cartridge).filter_by(state="installed").first()
            device = db.get(Device, outgoing.device_id)
            payload = {"item_id": incoming.item_id, "device_id": device.id, "slot": outgoing.slot,
                       "removed_item_id": outgoing.item_id, "date": AS_OF.isoformat(),
                       "destination": {"holder_type": "department", "branch_id": device.department.branch_id,
                                       "department_id": device.department_id}}
        with patch("routers.cartridges.check_date"):
            response = self.client.post("/api/cartridges/install", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["state"], "installed")
        self.assertEqual(self.get(f"cartridges/{payload['removed_item_id']}")["state"], "empty")


if __name__ == "__main__":
    unittest.main()
