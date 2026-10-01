import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import Device, DeviceStatus, DeviceType, RepairRecord, RepairStatus, RepairType
from routers.repairs import recalculate_device_repair_deltas


class RepairReportTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.session = sessionmaker(bind=self.engine)()
        self.device = Device(
            inventory_number="1-00001",
            manufacturer="Kyocera",
            model="ECOSYS M2040dn",
            device_type=DeviceType.mfc,
            status=DeviceStatus.active,
        )
        self.session.add(self.device)
        self.session.flush()

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    def add_repair(self, repair_date, counter):
        repair = RepairRecord(
            device_id=self.device.id,
            date=repair_date,
            repair_type=RepairType.unplanned,
            repair_status=RepairStatus.completed,
            description="Проверка",
            completion_page_counter=counter,
        )
        self.session.add(repair)
        self.session.flush()
        return repair

    def test_counter_delta_is_calculated_between_completed_repairs(self):
        first = self.add_repair(date(2026, 1, 1), 100)
        second = self.add_repair(date(2026, 2, 1), 160)
        third = self.add_repair(date(2026, 3, 1), 250)

        recalculate_device_repair_deltas(self.session, self.device.id)

        self.assertIsNone(first.page_counter_delta)
        self.assertEqual(second.page_counter_delta, 60)
        self.assertEqual(third.page_counter_delta, 90)

    def test_missing_counter_starts_a_new_period(self):
        first = self.add_repair(date(2026, 1, 1), 100)
        missing = self.add_repair(date(2026, 2, 1), None)
        third = self.add_repair(date(2026, 3, 1), 250)

        recalculate_device_repair_deltas(self.session, self.device.id)

        self.assertIsNone(first.page_counter_delta)
        self.assertIsNone(missing.page_counter_delta)
        self.assertIsNone(third.page_counter_delta)


if __name__ == "__main__":
    unittest.main()
