import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from inventory_numbers import (
    format_inventory_number,
    inventory_sequence,
    migrate_inventory_numbers,
    next_inventory_number,
    require_inventory_number,
)
from models import Device, DeviceStatus, DeviceType, WarehouseItem


class InventoryNumberTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.session = sessionmaker(bind=self.engine)()

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    @staticmethod
    def device(number):
        return Device(
            inventory_number=number,
            manufacturer="Kyocera",
            model="M2040dn",
            device_type=DeviceType.mfc,
            status=DeviceStatus.active,
        )

    def test_format_and_validation(self):
        self.assertEqual(format_inventory_number(1), "1-00001")
        self.assertEqual(format_inventory_number(99999), "1-99999")
        self.assertEqual(inventory_sequence("1-00123"), 123)
        self.assertEqual(require_inventory_number(" 1-00007 "), "1-00007")
        for value in ("123", "1-123", "2-00001", "1-00000", ""):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    require_inventory_number(value)

    def test_migration_is_global_and_preserves_free_numeric_value(self):
        self.session.add_all([
            self.device("12"),
            self.device("1-00005"),
            WarehouseItem(
                name="Монитор",
                category="Мониторы",
                tracking_type="asset",
                inventory_number="PC-OLD",
            ),
            WarehouseItem(
                name="Компьютер",
                category="Компьютеры",
                tracking_type="asset",
                inventory_number="1-00005",
            ),
        ])
        self.session.commit()

        changes = migrate_inventory_numbers(self.session)
        self.session.commit()

        numbers = {
            *[row.inventory_number for row in self.session.query(Device).all()],
            *[row.inventory_number for row in self.session.query(WarehouseItem).all()],
        }
        self.assertEqual(numbers, {"1-00001", "1-00002", "1-00005", "1-00012"})
        self.assertEqual(len(changes), 3)
        self.assertEqual(next_inventory_number(self.session), "1-00003")

    def test_next_number_fills_gap_before_higher_numbers(self):
        self.session.add_all([
            self.device(format_inventory_number(sequence))
            for sequence in [*range(1, 37), 123, 124, 125]
        ])
        self.session.commit()

        self.assertEqual(next_inventory_number(self.session), "1-00037")


if __name__ == "__main__":
    unittest.main()
