import unittest
from datetime import date, datetime

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, get_db
from models import Employee, EquipmentEvent, WarehouseItem, Workplace, WorkplaceAssetAssignment
from routers import history, warehouse
from routers.auth import get_current_user


class TableFiltersApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        app = FastAPI()
        app.include_router(warehouse.router, prefix='/api/warehouse')
        app.include_router(history.router, prefix='/api/history')

        def db_override():
            with self.sessions() as db:
                yield db

        app.dependency_overrides[get_db] = db_override
        app.dependency_overrides[get_current_user] = lambda: {'username': 'editor'}
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_equipment_list_and_card_use_current_workplace_after_editing(self):
        with self.sessions() as db:
            employee = Employee(full_name='Иванов Иван')
            place = Workplace(name='Серверная стойка', location='Комната 205', employee=employee)
            old_place = Workplace(name='Старое место')
            item = WarehouseItem(name='Коммутатор', category='Коммутаторы', tracking_type='asset',
                                 placement='Рабочее место', condition='Рабочий')
            db.add_all([employee, place, old_place, item])
            db.flush()
            db.add_all([
                WorkplaceAssetAssignment(item=item, workplace=old_place, assigned_at=date(2026, 9, 1), ended_at=date(2026, 9, 2)),
                WorkplaceAssetAssignment(item=item, workplace=place, assigned_at=date(2026, 9, 2)),
            ])
            db.commit()
            item_id, place_id = item.id, place.id
        listing = self.client.get('/api/warehouse/items').json()[0]
        expected = {'id': place_id, 'name': 'Серверная стойка', 'location': 'Комната 205'}
        self.assertEqual(listing['workplace'], expected)
        self.assertEqual(listing['responsible_person'], 'Иванов Иван')
        self.assertEqual(self.client.get(f'/api/warehouse/items/{item_id}').json()['workplace'], expected)
        updated = self.client.put(f'/api/warehouse/items/{item_id}', json={'name': 'Коммутатор обновлён', 'inventory_number': '1-00294', 'notes': 'Проверен'})
        self.assertEqual(updated.status_code, 200, updated.text)
        listing = self.client.get('/api/warehouse/items').json()[0]
        self.assertEqual(listing['workplace'], expected)
        self.assertEqual(listing['inventory_number'], '1-00294')
        self.assertEqual(listing['name'], 'Коммутатор обновлён')
        with self.sessions() as db:
            active = db.query(WorkplaceAssetAssignment).filter_by(ended_at=None).one()
            active.ended_at = date(2026, 10, 6)
            db.commit()
        listing = self.client.get('/api/warehouse/items').json()[0]
        self.assertIsNone(listing['workplace'])
        self.assertIsNone(listing['responsible_person'])

    def seed_events(self):
        with self.sessions() as db:
            for index, actor, name, employee in (
                (1, 'collector', 'Old PC', 'Smith'), (2, 'operator', 'Switch 100%', 'Ivanov'),
                (3, 'operator', 'Switch 100%', 'Ivanov'), (4, 'collector', 'Newest PC', 'Smith'),
            ):
                db.add(EquipmentEvent(occurred_at=datetime(2026, 10, index), category='equipment',
                                      event_type='updated', entity_type='warehouse_item', entity_id=index,
                                      entity_name=name, title='Changed', actor=actor, employee_name=employee,
                                      inventory_number=f'1-{index:05d}', from_value='Rack_A', to_value='Office B'))
            db.commit()

    def test_history_column_filters_run_before_pagination_and_combine(self):
        self.seed_events()
        params = {'page_size': 1, 'entity_search': 'Switch', 'employee_search': 'Ivan', 'actor_search': 'operator', 'movement_search': 'Rack_A'}
        response = self.client.get('/api/history', params=params)
        self.assertEqual(response.status_code, 200, response.text)
        first = response.json()
        self.assertEqual(first['total'], 2)
        self.assertEqual(first['items'][0]['entity_id'], 3)
        second = self.client.get('/api/history', params={**params, 'page': 2}).json()
        self.assertEqual(second['total'], 2)
        self.assertEqual(second['items'][0]['entity_id'], 2)
        filtered = self.client.get('/api/history', params={**params, 'date_from': '2026-10-03'}).json()
        self.assertEqual(filtered['total'], 1)
        empty = self.client.get('/api/history', params={**params, 'actor_search': 'collector'}).json()
        self.assertEqual(empty['total'], 0)

    def test_history_filters_match_literal_percent_and_underscore(self):
        self.seed_events()
        self.assertEqual(self.client.get('/api/history', params={'entity_search': '100%'}).json()['total'], 2)
        self.assertEqual(self.client.get('/api/history', params={'entity_search': '%'}).json()['total'], 2)
        self.assertEqual(self.client.get('/api/history', params={'entity_search': '_'}).json()['total'], 0)
        self.assertEqual(self.client.get('/api/history', params={'movement_search': '_A'}).json()['total'], 4)
