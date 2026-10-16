import unittest
from datetime import date, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from unittest.mock import patch
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm.exc import StaleDataError
from sqlalchemy.pool import StaticPool

from database import Base, get_db
from models import (Branch, Cartridge, CartridgeOperation, Department, Device, DeviceType, Employee,
                    StockMovement, StockMovementType, WarehouseItem)
from routers import cartridges, devices, employees, inventory, orgs, warehouse, workplaces
from routers.auth import get_current_user


class CartridgeTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        self.addCleanup(self.engine.dispose)
        with self.sessions() as db:
            branch = Branch(name="Филиал")
            db.add(branch)
            db.flush()
            department = Department(name="Бухгалтерия", branch_id=branch.id)
            db.add(department)
            db.flush()
            employee = Employee(full_name="Иванов", branch_id=branch.id, department_id=department.id)
            device = Device(manufacturer="Kyocera", model="M2040dn", device_type=DeviceType.mfc, department_id=department.id)
            db.add_all([employee, device])
            db.commit()
            self.branch, self.department, self.employee, self.device = branch.id, department.id, employee.id, device.id
        self.today = date.today().isoformat()
        self.target = {"holder_type": "employee", "branch_id": self.branch,
                       "department_id": self.department, "employee_id": self.employee}
        self.store = {"holder_type": "warehouse", "branch_id": self.branch, "department_id": self.department}
        app = FastAPI()
        for name, module in [("cartridges", cartridges), ("warehouse", warehouse), ("devices", devices),
                             ("inventory", inventory), ("employees", employees), ("orgs", orgs), ("workplaces", workplaces)]:
            app.include_router(module.router, prefix=f"/api/{name}")
        def get_test_db():
            with self.sessions() as db:
                yield db
        app.dependency_overrides[get_db] = get_test_db
        app.dependency_overrides[get_current_user] = lambda: {"username": "tester"}
        self.app = app
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def create(self, *numbers, **changes):
        payload = {"inventory_numbers": list(numbers), "name": "TK-1170", "date": self.today,
                   "branch_id": self.branch, "department_id": self.department, **changes}
        response = self.client.post("/api/cartridges", json=payload)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def action(self, ids, operation, expected=200, **changes):
        response = self.client.post("/api/cartridges/actions", json={
            "item_ids": ids, "operation": operation, "date": self.today, **changes,
        })
        self.assertEqual(response.status_code, expected, response.text)
        return response.json()

    def install(self, incoming, outgoing=None, slot="Основной", expected=200):
        response = self.client.post("/api/cartridges/install", json={
            "item_id": incoming, "device_id": self.device, "slot": slot,
            "removed_item_id": outgoing, "date": self.today, "destination": self.target,
        })
        self.assertEqual(response.status_code, expected, response.text)
        return response.json()

    def card(self, item_id):
        return self.client.get(f"/api/cartridges/{item_id}").json()

    def test_complete_cycle_transfer_replace_partial_refill_return_and_write_off(self):
        first, second, third = self.create("1-00301", "1-00302", "1-00303")
        ids = [first['item_id'], second['item_id'], third['item_id']]
        moved = self.action(ids, "transfer", destination=self.target)
        self.assertTrue(all(row['employee_name'] == 'Иванов' for row in moved))
        self.assertTrue(all('Бухгалтерия' in row['location'] for row in moved))
        self.install(ids[0])
        self.install(ids[1], outgoing=ids[0])
        self.assertEqual(self.card(ids[0])['state'], 'empty')
        self.assertEqual(self.card(ids[0])['last_removed_at'], self.today)
        self.assertIsNone(self.card(ids[0])['device_id'])
        self.assertEqual(self.card(ids[1])['state'], 'installed')
        self.action([ids[1]], "remove", destination=self.target)
        self.action(ids[:2], "send_refill", contractor="Сервис")
        self.assertEqual(self.card(ids[0])['contractor'], 'Сервис')
        self.action([ids[0]], "return_refill", destination=self.store)
        self.assertEqual(self.card(ids[0])['state'], 'ready')
        self.assertEqual(self.card(ids[0])['refill_count'], 1)
        self.assertEqual(self.card(ids[1])['state'], 'refilling')
        self.action([ids[1]], "return_refill", destination=self.store, result="defective")
        self.assertEqual(self.card(ids[1])['refill_count'], 0)
        self.action([ids[1]], "write_off")
        self.action([ids[1]], "transfer", destination=self.target, expected=409)
        active = self.client.get('/api/warehouse/items').json()
        self.assertNotIn(ids[1], [item['id'] for item in active])
        history = self.client.get('/api/cartridges/operations', params={'device_id': self.device}).json()
        self.assertEqual([row['operation'] for row in history].count('install'), 2)
        self.assertTrue(all(row['device_name'] == 'Kyocera M2040dn' for row in history))
        self.assertTrue(all(row['actor'] == 'tester' for row in history))
        # Both sides of a replacement are one operation batch.
        replacement = next(row for row in history if row['operation'] == 'install' and row['item_id'] == ids[1])
        self.assertTrue(any(row['operation'] == 'remove' and row['batch_id'] == replacement['batch_id'] for row in history))

    def test_failed_batch_does_not_change_any_cartridge(self):
        empty = self.create('1-00301', state='empty')[0]['item_id']
        ready = self.create('1-00302')[0]['item_id']
        self.action([empty, ready], 'send_refill', contractor='Сервис', expected=409)
        self.assertEqual(self.card(empty)['state'], 'empty')
        self.assertEqual(self.card(ready)['state'], 'ready')
        self.assertEqual(len(self.client.get('/api/cartridges/operations').json()), 2)

    def test_existing_quantity_converts_without_doubling_and_cannot_be_undone_as_stock_issue(self):
        with self.sessions() as db:
            source = WarehouseItem(name='TK-1170', category='Картриджи', tracking_type='quantity',
                                   branch_id=self.branch, department_id=self.department)
            db.add(source)
            db.flush()
            db.add(StockMovement(item_id=source.id, date=date.today(), movement_type=StockMovementType.receipt, quantity=3))
            db.commit()
            source_id = source.id
        self.create('1-00301', '1-00302', source_item_id=source_id)
        rows = self.client.get('/api/warehouse/items').json()
        self.assertEqual(sum(row['current_quantity'] for row in rows), 3)
        self.assertEqual(next(row['current_quantity'] for row in rows if row['id'] == source_id), 1)
        with self.sessions() as db:
            movement = db.query(StockMovement).filter_by(item_id=source_id, cartridge_conversion=True).one()
            movement_id = movement.id
        self.assertEqual(self.client.delete(f'/api/warehouse/movements/{movement_id}').status_code, 409)
        response = self.client.post('/api/cartridges', json={
            'inventory_numbers': ['1-00303', '1-00304'], 'name': 'TK-1170', 'date': self.today,
            'branch_id': self.branch, 'department_id': self.department, 'source_item_id': source_id,
        })
        self.assertEqual(response.status_code, 409)
        self.assertEqual(len(self.client.get('/api/cartridges').json()), 2)

    def test_inventory_numbers_are_shared_with_devices_and_warehouse(self):
        with self.sessions() as db:
            db.get(Device, self.device).inventory_number = '1-00301'
            db.commit()
        response = self.client.post('/api/cartridges', json={
            'inventory_numbers': ['1-00302', '1-00301'], 'name': 'TK-1170', 'date': self.today, 'branch_id': self.branch,
        })
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.client.get('/api/cartridges').json(), [])
        record = self.create('1-00302')[0]
        self.assertEqual(self.client.get('/api/inventory/lookup/1-00302').json()['path'], f"/cartridges/{record['item_id']}")
        self.assertEqual(self.client.put(f'/api/devices/{self.device}', json={'inventory_number': '1-00302'}).status_code, 409)

    def test_slots_and_stale_replacement_selection(self):
        a, b, c = [row['item_id'] for row in self.create('1-00301', '1-00302', '1-00303')]
        self.install(a, slot='Чёрный')
        self.install(b, slot='Голубой')
        self.install(c, slot='Чёрный', expected=409)
        self.assertEqual(self.card(c)['state'], 'ready')
        self.install(c, outgoing=a, slot='Чёрный')
        self.assertEqual(self.card(a)['state'], 'empty')
        self.assertEqual(self.card(b)['state'], 'installed')

    def test_state_dates_and_recipient_validation(self):
        item_id = self.create('1-00301')[0]['item_id']
        self.action([item_id], 'send_refill', contractor='Сервис', expected=409)
        self.action([item_id], 'return_refill', destination=self.store, expected=409)
        self.action([item_id], 'remove', destination=self.store, expected=409)
        self.action([item_id], 'transfer', destination={**self.target, 'branch_id': 999}, expected=422)
        self.action([item_id], 'transfer', destination=self.store, date=(date.today() - timedelta(days=1)).isoformat(), expected=409)
        self.action([item_id], 'transfer', destination=self.store, date=(date.today() + timedelta(days=1)).isoformat(), expected=422)
        self.action([item_id, item_id], 'transfer', destination=self.store, expected=422)

    def test_general_equipment_operations_cannot_bypass_lifecycle(self):
        item_id = self.create('1-00301')[0]['item_id']
        self.assertEqual(self.client.put(f'/api/warehouse/items/{item_id}', json={'condition': 'Списан'}).status_code, 409)
        self.assertEqual(self.client.put(f'/api/warehouse/items/{item_id}', json={'inventory_number': None}).status_code, 409)
        self.assertEqual(self.client.put(f'/api/warehouse/items/{item_id}', json={'notes': 'Новая заметка'}).status_code, 200)
        self.assertEqual(self.client.delete(f'/api/warehouse/items/{item_id}').status_code, 409)
        self.assertEqual(self.client.post(f'/api/warehouse/items/{item_id}/movements', json={
            'date': self.today, 'movement_type': 'issue', 'quantity': 1,
        }).status_code, 409)
        self.assertNotIn(item_id, [row['id'] for row in self.client.get('/api/workplaces/available-assets').json()])
        with self.sessions() as db:
            item = db.get(WarehouseItem, item_id)
            with self.assertRaisesRegex(ValueError, 'историей оборота'):
                inventory._import_warehouse_item(db, item.inventory_number, {})

    def test_ownership_and_installed_printer_are_protected_from_deletion(self):
        item_id = self.create('1-00301')[0]['item_id']
        self.action([item_id], 'transfer', destination=self.target)
        self.assertEqual(self.client.delete(f'/api/employees/{self.employee}').status_code, 409)
        self.assertEqual(self.client.put(f'/api/employees/{self.employee}', json={'is_active': False}).status_code, 409)
        self.assertEqual(self.client.delete(f'/api/orgs/departments/{self.department}').status_code, 409)
        self.install(item_id)
        self.assertEqual(self.client.delete(f'/api/devices/{self.device}').status_code, 409)
        self.assertEqual(self.client.put(f'/api/devices/{self.device}', json={'status': 'decommissioned'}).status_code, 409)
        self.assertEqual(self.client.put(f'/api/devices/{self.device}', json={'department_id': None}).status_code, 409)

    def test_optimistic_version_prevents_lost_updates(self):
        item_id = self.create('1-00301')[0]['item_id']
        with self.sessions() as first, self.sessions() as second:
            old = first.get(Cartridge, item_id)
            latest = second.get(Cartridge, item_id)
            latest.state = 'empty'
            second.commit()
            old.state = 'defective'
            with self.assertRaises(StaleDataError):
                first.commit()

    def test_api_requires_authentication(self):
        self.app.dependency_overrides.pop(get_current_user)
        self.assertEqual(self.client.get('/api/cartridges').status_code, 401)
        self.assertEqual(self.client.get('/api/cartridges/operations').status_code, 401)

    def test_existing_asset_is_enrolled_without_duplicate_card_or_stock_receipt(self):
        response = self.client.post('/api/warehouse/items', json={
            'name': 'TK-1170', 'category': 'Картриджи', 'tracking_type': 'asset',
            'inventory_number': '1-00301', 'branch_id': self.branch, 'department_id': self.department,
        })
        self.assertEqual(response.status_code, 201, response.text)
        source_id = response.json()['id']
        row = self.create('1-00301', source_item_id=source_id)[0]
        self.assertEqual(row['item_id'], source_id)
        self.assertEqual(len(self.client.get('/api/warehouse/items').json()), 1)
        with self.sessions() as db:
            self.assertEqual(db.query(StockMovement).filter_by(item_id=source_id).count(), 1)

    def test_existing_database_migration_preserves_stock_and_is_repeatable(self):
        from database import initialize_database
        with self.sessions() as db:
            item = WarehouseItem(name='TK-1170', category='Картриджи', branch_id=self.branch,
                                 department_id=self.department, tracking_type='quantity')
            db.add(item)
            db.flush()
            db.add(StockMovement(item_id=item.id, date=date.today(), movement_type=StockMovementType.receipt, quantity=3))
            db.commit()
            source_id = item.id
        with self.engine.begin() as connection:
            connection.execute(text('DROP TABLE cartridge_operations'))
            connection.execute(text('DROP TABLE cartridges'))
            connection.execute(text('ALTER TABLE stock_movements DROP COLUMN cartridge_conversion'))
        with patch('database.engine', self.engine):
            initialize_database()
            initialize_database()
        self.assertIn('cartridges', inspect(self.engine).get_table_names())
        self.assertIn('cartridge_operations', inspect(self.engine).get_table_names())
        self.assertEqual(self.client.get(f'/api/warehouse/items/{source_id}').json()['current_quantity'], 3)
        cartridge_id = self.create('1-00301', source_item_id=source_id)[0]['item_id']
        self.assertEqual(self.client.get(f'/api/warehouse/items/{source_id}').json()['current_quantity'], 2)
        with self.sessions() as db:
            db.get(WarehouseItem, cartridge_id).condition = 'Готов к установке'
            db.commit()
            version = db.get(Cartridge, cartridge_id).version
            operation_count = db.query(CartridgeOperation).count()
        with patch('database.engine', self.engine):
            initialize_database()
            initialize_database()
        with self.sessions() as db:
            self.assertEqual(db.get(WarehouseItem, cartridge_id).condition, 'Запасной')
            self.assertEqual(db.get(Cartridge, cartridge_id).version, version)
            self.assertEqual(db.query(CartridgeOperation).count(), operation_count)


if __name__ == '__main__':
    unittest.main()
