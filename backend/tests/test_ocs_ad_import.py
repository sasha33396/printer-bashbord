import copy
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import database
from database import Base, get_db
from models import (
    Branch, Department, Employee, EquipmentEvent, OcsAssetLink, OcsImportRun,
    StockMovement, WarehouseItem, Workplace, WorkplaceAssetAssignment,
)
from routers import employees, integrations, warehouse, workplaces
from routers.auth import _create_token, get_current_user
from routers.integrations import get_import_user
from routers.inventory import _import_warehouse_item, _warehouse_card


class OcsAdImportTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, autoflush=False)
        self.app = FastAPI()
        self.app.include_router(integrations.router, prefix="/api/integrations")
        self.app.include_router(employees.router, prefix="/api/employees")
        self.app.include_router(warehouse.router, prefix="/api/warehouse")
        self.app.include_router(workplaces.router, prefix="/api/workplaces")

        def database_override():
            with self.sessions() as db:
                yield db

        self.app.dependency_overrides[get_db] = database_override
        self.app.dependency_overrides[get_current_user] = lambda: {"username": "test-admin"}
        self.app.dependency_overrides[get_import_user] = lambda: {"username": "test-import"}
        self.client = TestClient(self.app)
        self.record = {
            "ocs_id": 94, "computer_name": "ws-test-01",
            "last_inventory_at": datetime.now(timezone.utc).isoformat(),
            "domain": "RUSKON.LOCAL", "ad_login": " M.SHUTOV ",
            "ad_guid": "3dc0fec6-9dfa-40dd-b115-cf6eaa9b4642",
            "full_name": "Шутов Максим", "ad_enabled": True,
            "computer": {
                "manufacturer": "Acer", "model": "Aspire XC-1660",
                "serial_number": "PC-001", "ram_gb": 4,
                "processor": "Intel Core i3-10105", "ip_address": "172.16.55.197",
                "mac_address": "1c:69:7a:9e:c7:ac", "os_name": "Windows 11 Pro",
            },
            "monitors": [{"ocs_id": 72, "name": "S24D300", "manufacturer": "Samsung", "serial_number": "MON-001"}],
        }

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def submit(self, records=None, dry_run=False, **options):
        payload = {"source": "ocs", "source_key": "main", "dry_run": dry_run, "records": records or [copy.deepcopy(self.record)]}
        payload.update(options)
        response = self.client.post("/api/integrations/ocs-ad/import", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def counts(self):
        with self.sessions() as db:
            return {model.__name__: db.query(model).count() for model in (
                Employee, WarehouseItem, Workplace, WorkplaceAssetAssignment,
                StockMovement, EquipmentEvent, OcsAssetLink, OcsImportRun,
            )}

    def second_record(self):
        record = copy.deepcopy(self.record)
        record.update(ocs_id=95, computer_name="WS-TEST-02", ad_login="a.other", ad_guid=None, full_name="Другой сотрудник")
        record["computer"]["serial_number"] = "PC-002"
        record["monitors"] = []
        return record

    def test_preview_rolls_back_every_table_and_apply_matches_it(self):
        report = self.submit(dry_run=True)
        self.assertEqual(report["employees_created"], 1)
        self.assertEqual(report["computers_created"], 1)
        self.assertEqual(report["monitors_created"], 1)
        self.assertEqual(report["assets_assigned"], 2)
        self.assertIsNone(report["run_id"])
        self.assertTrue(all(count == 0 for count in self.counts().values()))
        applied = self.submit()
        self.assertEqual(applied["records"], report["records"])

    def test_apply_creates_complete_unlocated_link_and_audit(self):
        report = self.submit()
        with self.sessions() as db:
            employee = db.query(Employee).one()
            workplace = db.query(Workplace).one()
            self.assertEqual((employee.ad_login, employee.ad_domain), ("m.shutov", "ruskon.local"))
            self.assertEqual(workplace.employee_id, employee.id)
            self.assertIsNone(workplace.branch_id)
            assets = db.query(WarehouseItem).order_by(WarehouseItem.id).all()
            self.assertEqual([asset.inventory_number for asset in assets], ["1-00001", "1-00002"])
            self.assertTrue(all(asset.branch_id is None for asset in assets))
            self.assertTrue(all(asset.placement == "Рабочее место" for asset in assets))
            self.assertEqual(assets[0].os_name, "Windows 11 Pro")
            self.assertEqual(db.query(WorkplaceAssetAssignment).count(), 2)
            self.assertEqual(db.query(StockMovement).count(), 2)
            self.assertEqual(db.query(EquipmentEvent).count(), 4)
            self.assertTrue(all(event.actor == "test-import" for event in db.query(EquipmentEvent)))
        run = self.client.get(f"/api/integrations/ocs-ad/runs/{report['run_id']}")
        self.assertEqual(run.status_code, 200)
        self.assertEqual(run.json(), report)

    def test_repeated_import_does_not_duplicate_cards_assignments_or_events(self):
        self.submit()
        before = self.counts()
        report = self.submit()
        after = self.counts()
        for name in before:
            if name != "OcsImportRun":
                self.assertEqual(after[name], before[name], name)
        self.assertEqual(report["records"][0]["status"], "unchanged")
        self.assertEqual(report["assets_assigned"], 0)

    def test_monitor_without_serial_is_reported_and_not_duplicated(self):
        record = copy.deepcopy(self.record)
        record["monitors"][0]["serial_number"] = ""
        first = self.submit([record])
        second = self.submit([record])
        self.assertEqual(first["monitors_created"], 0)
        self.assertEqual(first["warnings"], 1)
        self.assertEqual(second["warnings"], 1)
        self.assertEqual(self.counts()["WarehouseItem"], 1)

    def test_serialless_monitor_can_be_explicitly_matched_to_existing_card(self):
        created = self.client.post("/api/warehouse/items", json={"name": "Мой монитор", "category": "Мониторы", "tracking_type": "asset"})
        self.assertEqual(created.status_code, 201, created.text)
        record = copy.deepcopy(self.record)
        record["monitors"][0].update(serial_number="", item_id=created.json()["id"])
        report = self.submit([record])
        self.assertEqual(report["monitors_created"], 0)
        self.assertEqual(report["assets_assigned"], 2)
        self.submit([record])
        self.assertEqual(self.counts()["WarehouseItem"], 2)
        with self.sessions() as db:
            self.assertEqual(db.get(WarehouseItem, created.json()["id"]).name, "Мой монитор")

    def test_same_monitor_model_with_distinct_serials_creates_distinct_assets(self):
        record = copy.deepcopy(self.record)
        record["monitors"].append({"ocs_id": 73, "name": "S24D300", "serial_number": "MON-002"})
        report = self.submit([record])
        self.assertEqual(report["monitors_created"], 2)
        self.assertEqual(report["assets_assigned"], 3)

    def test_changed_user_is_conflict_and_rolls_back_new_employee(self):
        self.submit()
        before = self.counts()
        record = copy.deepcopy(self.record)
        record.update(ad_login="another.user", ad_guid=None, full_name="Другой пользователь")
        report = self.submit([record])
        self.assertEqual(report["conflicts"], 1)
        self.assertIsNone(report["records"][0]["employee_id"])
        for name, count in before.items():
            if name != "OcsImportRun":
                self.assertEqual(self.counts()[name], count, name)

    def test_monitor_already_assigned_elsewhere_rolls_back_entire_record(self):
        self.submit()
        record = self.second_record()
        record["monitors"] = [{"ocs_id": 73, "name": "S24D300", "serial_number": "MON-001"}]
        report = self.submit([record])
        self.assertEqual(report["conflicts"], 1)
        self.assertEqual(self.counts()["Employee"], 1)
        self.assertEqual(self.counts()["WarehouseItem"], 2)
        self.assertEqual(self.counts()["EquipmentEvent"], 4)

    def test_invalid_location_does_not_abort_other_records(self):
        invalid = self.second_record()
        invalid["branch_id"] = 999
        report = self.submit([copy.deepcopy(self.record), invalid])
        self.assertEqual([record["status"] for record in report["records"]], ["created", "conflict"])
        self.assertEqual(report["employees_created"], 1)
        self.assertEqual(self.counts()["Employee"], 1)

    def test_same_employee_on_two_computers_is_conflict_for_both_records(self):
        second = self.second_record()
        second.update(ad_login=self.record["ad_login"], ad_guid=self.record["ad_guid"])
        report = self.submit([copy.deepcopy(self.record), second])
        self.assertEqual(report["conflicts"], 2)
        self.assertEqual(self.counts()["WarehouseItem"], 0)

    def test_disabled_missing_service_and_stale_users_are_skipped(self):
        changes = [
            {"ad_enabled": False}, {"full_name": None}, {"ad_login": "admin"},
            {"last_inventory_at": (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()},
        ]
        for change in changes:
            with self.subTest(change=change):
                record = copy.deepcopy(self.record)
                record.update(change)
                self.assertEqual(self.submit([record])["skipped"], 1)
        self.assertEqual(self.counts()["WarehouseItem"], 0)

    def test_old_snapshot_cannot_overwrite_newer_inventory(self):
        self.submit()
        record = copy.deepcopy(self.record)
        record["last_inventory_at"] = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        record["computer"]["ram_gb"] = 8
        record["full_name"] = "Старое имя"
        report = self.submit([record])
        self.assertEqual(report["skipped"], 1)
        with self.sessions() as db:
            self.assertEqual(db.query(Employee).one().full_name, "Шутов Максим")
            self.assertEqual(db.query(WarehouseItem).filter_by(category="Компьютеры").one().ram_gb, 4)

    def test_manual_fields_are_preserved_but_managed_fields_update(self):
        record = copy.deepcopy(self.record)
        record["email"] = "old@example.test"
        self.submit([record])
        with self.sessions() as db:
            employee = db.query(Employee).one()
            employee.email = "manual@example.test"
            db.commit()
        record["email"] = "new@example.test"
        record["computer"]["ram_gb"] = 8
        report = self.submit([record])
        self.assertEqual(report["warnings"], 1)
        self.assertEqual(report["computers_updated"], 1)
        with self.sessions() as db:
            self.assertEqual(db.query(Employee).one().email, "manual@example.test")
            self.assertEqual(db.query(WarehouseItem).filter_by(category="Компьютеры").one().ram_gb, 8)
        record["email"] = None
        record["computer"]["ram_gb"] = None
        self.submit([record])
        with self.sessions() as db:
            self.assertEqual(db.query(Employee).one().email, "manual@example.test")
            self.assertEqual(db.query(WarehouseItem).filter_by(category="Компьютеры").one().ram_gb, 8)

    def test_login_rename_with_same_guid_keeps_employee_and_workplace(self):
        self.submit()
        record = copy.deepcopy(self.record)
        record["ad_login"] = "m.newlogin"
        report = self.submit([record])
        self.assertEqual(report["employees_updated"], 1)
        self.assertEqual(report["conflicts"], 0)
        self.assertEqual(self.counts()["Employee"], 1)
        self.assertEqual(self.counts()["Workplace"], 1)

    def test_reused_login_with_new_guid_is_conflict(self):
        self.submit()
        record = copy.deepcopy(self.record)
        record["ad_guid"] = "00000000-0000-0000-0000-000000000002"
        self.assertEqual(self.submit([record])["conflicts"], 1)

    def test_manual_employee_requires_explicit_matching_and_keeps_manual_fields(self):
        created = self.client.post("/api/employees", json={"full_name": "Шутов Максим", "position": "Руководитель"})
        self.assertEqual(created.status_code, 201)
        self.assertEqual(self.submit()["conflicts"], 1)
        record = copy.deepcopy(self.record)
        record.update(employee_id=created.json()["id"], position="Специалист")
        report = self.submit([record])
        self.assertEqual(report["employees_created"], 0)
        self.assertEqual(report["conflicts"], 0)
        with self.sessions() as db:
            self.assertEqual(db.query(Employee).one().position, "Руководитель")

    def test_serial_matching_reuses_existing_computer_after_ocs_id_changes(self):
        self.submit()
        record = copy.deepcopy(self.record)
        record["ocs_id"] = 999
        record["computer_name"] = "WS-RENAMED"
        report = self.submit([record])
        self.assertEqual(report["computers_created"], 0)
        self.assertEqual(report["conflicts"], 0)
        self.assertEqual(self.counts()["WarehouseItem"], 2)
        self.assertEqual(self.counts()["Workplace"], 1)

    def test_api_creates_equipment_and_workplace_without_branch(self):
        asset = self.client.post("/api/warehouse/items", json={"name": "ПК", "category": "Компьютеры", "tracking_type": "asset"})
        workplace = self.client.post("/api/workplaces", json={"name": "РМ"})
        self.assertEqual(asset.status_code, 201, asset.text)
        self.assertEqual(workplace.status_code, 201, workplace.text)
        self.assertIsNone(asset.json()["branch_id"])
        self.assertEqual(asset.json()["placement"], "Не определено")
        self.assertIsNone(workplace.json()["branch_id"])
        duplicate = self.client.post("/api/workplaces", json={"name": "рм"})
        self.assertEqual(duplicate.status_code, 409)

    def test_department_requires_existing_parent_branch(self):
        with self.sessions() as db:
            branch = Branch(name="Филиал")
            department = Department(name="Отдел", branch=branch)
            db.add_all([branch, department])
            db.commit()
            department_id = department.id
        for path, payload in (
            ("/api/warehouse/items", {"name": "ПК", "category": "Компьютеры"}),
            ("/api/workplaces", {"name": "РМ"}),
        ):
            payload["department_id"] = department_id
            self.assertEqual(self.client.post(path, json=payload).status_code, 422)

    def test_employee_login_normalization_search_and_uniqueness(self):
        employee = self.client.post("/api/employees", json={"full_name": "Первый", "ad_login": " M.SHUTOV ", "ad_domain": "RUSKON.LOCAL."})
        self.assertEqual(employee.status_code, 201, employee.text)
        duplicate = self.client.post("/api/employees", json={"full_name": "Второй", "ad_login": "m.shutov", "ad_domain": "ruskon.local"})
        self.assertEqual(duplicate.status_code, 409)
        found = self.client.get("/api/employees", params={"ad_login": "M.SHUTOV", "ad_domain": "RUSKON.LOCAL"})
        self.assertEqual([record["id"] for record in found.json()], [employee.json()["id"]])
        with self.sessions() as db:
            db.add(Employee(full_name="Обход API", ad_login="M.SHUTOV", ad_domain="ruskon.local"))
            with self.assertRaises(IntegrityError):
                db.commit()

    def test_import_token_is_rejected_by_regular_api_and_jwt_can_import(self):
        self.app.dependency_overrides.pop(get_import_user)
        self.app.dependency_overrides.pop(get_current_user)
        payload = {"records": [self.record]}
        with patch.dict("os.environ", {"OCS_AD_IMPORT_TOKEN": "test-scoped-import-secret"}):
            self.assertEqual(self.client.post("/api/integrations/ocs-ad/import", json=payload).status_code, 401)
            headers = {"Authorization": "Bearer test-scoped-import-secret"}
            response = self.client.post("/api/integrations/ocs-ad/import", json=payload, headers=headers)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(self.client.get("/api/employees", headers=headers).status_code, 401)
            admin = {"Authorization": "Bearer " + _create_token("admin")}
            self.assertEqual(self.client.post("/api/integrations/ocs-ad/import", json=payload, headers=admin).status_code, 200)

    def test_naive_timestamp_and_unknown_fields_are_rejected(self):
        record = copy.deepcopy(self.record)
        record["last_inventory_at"] = "2026-10-05T07:52:29"
        response = self.client.post("/api/integrations/ocs-ad/import", json={"records": [record]})
        self.assertEqual(response.status_code, 422)
        record = copy.deepcopy(self.record)
        record["unexpected"] = "not ignored"
        response = self.client.post("/api/integrations/ocs-ad/import", json={"records": [record]})
        self.assertEqual(response.status_code, 422)

    def test_equipment_archive_keeps_os_and_accepts_old_archive_without_it(self):
        self.submit()
        with self.sessions() as db:
            item = db.query(WarehouseItem).filter_by(category="Компьютеры").one()
            item.os_version = "10.0.26200"
            db.flush()
            card = _warehouse_card(item, db)
            item.os_name = None
            item.os_version = None
            _import_warehouse_item(db, item.inventory_number, card["data"])
            self.assertEqual(item.os_name, "Windows 11 Pro")
            self.assertEqual(item.os_version, "10.0.26200")
            legacy = dict(card["data"])
            legacy.pop("os_name")
            legacy.pop("os_version")
            _import_warehouse_item(db, item.inventory_number, legacy)
            self.assertEqual(item.os_name, "Windows 11 Pro")
            self.assertEqual(item.os_version, "10.0.26200")
    def test_migration_preserves_existing_employees_and_can_run_twice(self):
        with self.engine.begin() as connection:
            connection.execute(text("INSERT INTO employees (full_name, is_active) VALUES ('Существующий сотрудник', 1)"))
            connection.execute(text("DROP INDEX uq_employees_ad_identity"))
            connection.execute(text("DROP INDEX uq_employees_ad_guid"))
            for column in ("ad_login", "ad_domain", "ad_guid", "ad_sync_values"):
                connection.execute(text(f"ALTER TABLE employees DROP COLUMN {column}"))
        with patch.object(database, "engine", self.engine):
            database.initialize_database()
            database.initialize_database()
        self.assertIn("ad_login", {column["name"] for column in inspect(self.engine).get_columns("employees")})
        with self.sessions() as db:
            self.assertEqual(db.query(Employee).one().full_name, "Существующий сотрудник")
            self.assertIsNone(db.query(Employee).one().ad_login)


if __name__ == "__main__":
    unittest.main()
