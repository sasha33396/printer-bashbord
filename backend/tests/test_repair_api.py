import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, get_db
from models import Device, DeviceStatus, DeviceType
from routers import repairs
from routers.auth import get_current_user


class RepairApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine)
        session = self.session_factory()
        device = Device(
            inventory_number="1-00001",
            manufacturer="Kyocera",
            model="ECOSYS M2040dn",
            device_type=DeviceType.mfc,
            status=DeviceStatus.active,
        )
        session.add(device)
        session.commit()
        self.device_id = device.id
        session.close()

        app = FastAPI()
        app.include_router(repairs.router, prefix="/repairs")

        def database_override():
            db = self.session_factory()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = database_override
        app.dependency_overrides[get_current_user] = lambda: {"username": "test"}
        self.client = TestClient(app)
        self.temp_directory = tempfile.TemporaryDirectory()
        self.invoice_patch = patch(
            "repair_invoice_storage.INVOICE_ROOT",
            Path(self.temp_directory.name).resolve(),
        )
        self.invoice_patch.start()

    def tearDown(self):
        self.invoice_patch.stop()
        self.temp_directory.cleanup()
        self.engine.dispose()

    def create_completed_repair(self, repair_date, counter, work_cost):
        response = self.client.post("/repairs", json={
            "device_id": self.device_id,
            "date": repair_date,
            "repair_type": "unplanned",
            "repair_status": "completed",
            "description": "Треск при печати",
            "completion_page_counter": counter,
            "responsible_person": "Иванов И. И.",
            "work_items": [{"description": "Ремонт МФУ", "cost": work_cost}],
        })
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_report_fields_counter_period_and_invoice(self):
        first = self.create_completed_repair("2026-01-10", 1000, 3000)
        second = self.create_completed_repair("2026-02-10", 1450, 4200)

        self.assertIsNone(first["page_counter_delta"])
        self.assertEqual(second["page_counter_delta"], 450)
        self.assertEqual(second["cost"], 4200)
        self.assertEqual(second["responsible_person"], "Иванов И. И.")
        self.assertEqual(second["work_items"][0]["description"], "Ремонт МФУ")

        pdf = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n"
        uploaded = self.client.post(
            f"/repairs/{second['id']}/invoice",
            files={"file": ("invoice.pdf", pdf, "application/pdf")},
        )
        self.assertEqual(uploaded.status_code, 200, uploaded.text)
        self.assertEqual(uploaded.json()["invoice_name"], "invoice.pdf")

        downloaded = self.client.get(f"/repairs/{second['id']}/invoice")
        self.assertEqual(downloaded.status_code, 200)
        self.assertEqual(downloaded.content, pdf)


if __name__ == "__main__":
    unittest.main()
