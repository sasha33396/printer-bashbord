import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, get_db, initialize_database
from models import (Branch, Department, Device, DeviceType, Employee, MapMarker,
                    WarehouseItem, Workplace, WorkplaceAssetAssignment)
from routers import maps, orgs
from routers.auth import get_current_user

PNG = b'\x89PNG\r\n\x1a\n' + b'test plan'


class MapTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        @event.listens_for(self.engine, 'connect')
        def enable_keys(connection, _):
            connection.execute('PRAGMA foreign_keys=ON')
        Base.metadata.create_all(self.engine)
        self.addCleanup(self.engine.dispose)
        self.sessions = sessionmaker(bind=self.engine)
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        self.photo_patch = patch('photo_storage.PHOTO_ROOT', self.root)
        self.photo_patch.start()
        self.addCleanup(self.photo_patch.stop)
        with self.sessions() as db:
            branch = Branch(name='Основной филиал')
            other = Branch(name='Другой филиал')
            db.add_all([branch, other]); db.flush()
            department = Department(name='Бухгалтерия', branch_id=branch.id)
            db.add(department); db.flush()
            employee = Employee(full_name='Иванова Анна', branch_id=branch.id, department_id=department.id)
            db.add(employee); db.flush()
            workplace = Workplace(name='РМ-101', employee_id=employee.id, branch_id=branch.id, department_id=department.id)
            device = Device(manufacturer='Kyocera', model='M2040', device_type=DeviceType.mfc, department_id=department.id)
            asset = WarehouseItem(name='Монитор', category='Мониторы', tracking_type='asset', inventory_number='1-00401', branch_id=branch.id)
            quantity = WarehouseItem(name='Бумага', category='Расходники', tracking_type='quantity', branch_id=branch.id)
            foreign_asset = WarehouseItem(name='Другой монитор', category='Мониторы', tracking_type='asset', branch_id=other.id)
            db.add_all([workplace, device, asset, quantity, foreign_asset]); db.flush()
            from datetime import date
            db.add(WorkplaceAssetAssignment(workplace_id=workplace.id, item_id=asset.id, assigned_at=date.today()))
            db.commit()
            self.branch, self.other_branch = branch.id, other.id
            self.employee, self.workplace, self.device = employee.id, workplace.id, device.id
            self.asset, self.quantity, self.foreign_asset = asset.id, quantity.id, foreign_asset.id
        app = FastAPI()
        app.include_router(maps.router, prefix='/api/maps')
        app.include_router(orgs.router, prefix='/api/orgs')
        def get_test_db():
            with self.sessions() as db:
                yield db
        app.dependency_overrides[get_db] = get_test_db
        app.dependency_overrides[get_current_user] = lambda: {'username': 'map-editor'}
        self.app = app
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        response = self.client.post('/api/maps/buildings', json={'name': 'Административный корпус', 'branch_id': self.branch})
        self.assertEqual(response.status_code, 201, response.text)
        self.building = response.json()['id']
        self.floor = self.new_floor('1 этаж')

    def new_floor(self, name):
        response = self.client.post(f'/api/maps/buildings/{self.building}/floors', json={'name': name, 'width': 40, 'height': 25})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def get_floor(self, floor_id=None):
        return self.client.get(f"/api/maps/floors/{floor_id or self.floor['id']}").json()

    def marker(self, entity_type='workplace', entity_id=None, **changes):
        return {'entity_type': entity_type, 'entity_id': entity_id or self.workplace, 'x': 5, 'y': 6, **changes}

    def save(self, floor=None, status=200, image=None, **changes):
        floor = floor or self.floor
        document = {key: floor[key] for key in ['name', 'width', 'height', 'revision', 'shapes', 'background_opacity']}
        document['markers'] = [{key: row[key] for key in ['entity_type', 'entity_id', 'x', 'y', 'rotation']} for row in floor['markers']]
        document.update(changes)
        files = {'file': image} if image else None
        response = self.client.put(f"/api/maps/floors/{floor['id']}", data={'document': json.dumps(document)}, files=files)
        self.assertEqual(response.status_code, status, response.text)
        return response.json()

    def test_drawing_positions_live_employee_equipment_and_locator(self):
        shape = {'id': 'room-1', 'kind': 'room', 'x': 1, 'y': 1, 'width': 12, 'height': 8, 'label': 'Бухгалтерия', 'color': '#e6f4ff'}
        saved = self.save(shapes=[shape], markers=[self.marker(), self.marker('device', self.device, x=12)])
        self.assertEqual(saved['revision'], 2)
        self.assertEqual(saved['shapes'][0]['label'], 'Бухгалтерия')
        place = next(row for row in saved['markers'] if row['entity_type'] == 'workplace')
        self.assertEqual(place['entity']['employee_name'], 'Иванова Анна')
        self.assertEqual(place['entity']['equipment'][0]['inventory_number'], '1-00401')
        for kind, entity_id in [('workplace', self.workplace), ('employee', self.employee), ('warehouse_item', self.asset), ('device', self.device)]:
            result = self.client.get(f'/api/maps/locate/{kind}/{entity_id}').json()
            self.assertTrue(result['placed'])
            self.assertEqual(result['position']['floor_id'], self.floor['id'])
        with self.sessions() as db:
            db.get(Employee, self.employee).full_name = 'Иванова Анна Петровна'
            db.commit()
        self.assertEqual(self.get_floor()['markers'][0]['entity']['employee_name'], 'Иванова Анна Петровна')
        catalog = self.client.get('/api/maps/catalog').json()
        self.assertNotIn(self.quantity, [row['entity_id'] for row in catalog if row['entity_type'] == 'warehouse_item'])
        self.assertTrue(next(row for row in catalog if row['entity_type'] == 'warehouse_item' and row['entity_id'] == self.asset)['position']['inherited'])

    def test_stale_save_cannot_overwrite_plan_or_background(self):
        saved = self.save(markers=[self.marker()], image=('plan.png', PNG, 'image/png'))
        before_files = list(self.root.rglob('*.png'))
        self.save(status=409, name='Устаревший план', image=('stale.png', PNG + b'new', 'image/png'))
        current = self.get_floor()
        self.assertEqual(current['revision'], saved['revision'])
        self.assertEqual(current['name'], '1 этаж')
        self.assertEqual(list(self.root.rglob('*.png')), before_files)

    def test_background_upload_replace_remove_and_atomic_validation_failure(self):
        first = self.save(image=('plan.png', PNG, 'image/png'))
        self.assertTrue(first['has_background'])
        self.assertEqual(self.client.get(f"/api/maps/floors/{first['id']}/background").content, PNG)
        second = self.save(first, image=('second.png', PNG + b'second', 'image/png'), background_opacity=0.7)
        self.assertEqual(len(list(self.root.rglob('*.png'))), 1)
        self.assertEqual(second['background_opacity'], 0.7)
        self.save(second, status=422, image=('bad.png', PNG, 'image/png'), markers=[self.marker('warehouse_item', self.quantity)])
        self.assertEqual(len(list(self.root.rglob('*.png'))), 1)
        removed = self.save(second, remove_background=True)
        self.assertFalse(removed['has_background'])
        self.assertEqual(list(self.root.rglob('*.png')), [])

    def test_rejects_invalid_images_and_large_uploads(self):
        self.save(status=422, image=('evil.svg', b'<svg onload="bad"/>', 'image/svg+xml'))
        with patch('routers.maps.MAX_BACKGROUND_BYTES', 10):
            self.save(status=413, image=('large.png', PNG, 'image/png'))
        self.assertEqual(self.get_floor()['revision'], 1)

    def test_single_position_and_confirmed_transfer_between_floors(self):
        old = self.save(markers=[self.marker()])
        other = self.new_floor('2 этаж')
        self.save(other, status=409, markers=[self.marker()])
        moved = self.save(other, markers=[self.marker(from_floor_id=old['id'], from_revision=old['revision'])])
        self.assertEqual(len(moved['markers']), 1)
        source = self.get_floor(old['id'])
        self.assertEqual(source['markers'], [])
        self.assertEqual(source['revision'], old['revision'] + 1)
        self.save(old, status=409)
        with self.sessions() as db:
            self.assertEqual(db.query(MapMarker).count(), 1)

    def test_stale_source_revision_cancels_transfer_and_all_geometry(self):
        old = self.save(markers=[self.marker()])
        other = self.new_floor('2 этаж')
        latest = self.save(old, name='Первый этаж')
        self.save(other, status=409, name='Не сохранять', markers=[self.marker(from_floor_id=old['id'], from_revision=old['revision'])])
        self.assertEqual(self.get_floor(other['id'])['name'], '2 этаж')
        self.assertEqual(len(self.get_floor(old['id'])['markers']), 1)
        self.assertEqual(self.get_floor(old['id'])['revision'], latest['revision'])

    def test_validates_shapes_bounds_duplicates_and_branch(self):
        for changes in [
            {'markers': [self.marker(), self.marker()]},
            {'markers': [self.marker(x=41)]},
            {'markers': [self.marker('warehouse_item', self.foreign_asset)]},
            {'markers': [self.marker('warehouse_item', self.quantity)]},
            {'shapes': [{'id': 'bad', 'kind': 'wall', 'x': 1, 'y': 1, 'x2': 1, 'y2': 1}]},
            {'shapes': [{'id': 'room', 'kind': 'room', 'x': 39, 'y': 0, 'width': 2, 'height': 2}]},
            {'shapes': [{'id': 'script', 'kind': 'text', 'x': 0, 'y': 0, 'label': '   '}]},
        ]:
            with self.subTest(changes=changes):
                self.save(status=422, **changes)
                self.assertEqual(self.get_floor()['revision'], 1)

    def test_archived_and_deleted_objects_remain_visible_without_broken_cards(self):
        current = self.save(markers=[self.marker(), self.marker('device', self.device, x=15)])
        with self.sessions() as db:
            db.get(Workplace, self.workplace).is_archived = True
            db.delete(db.get(Device, self.device))
            db.commit()
        loaded = self.get_floor()
        self.assertTrue(all(row['entity']['available'] is False for row in loaded['markers']))
        deleted = next(row for row in loaded['markers'] if row['entity_type'] == 'device')
        self.assertEqual(deleted['entity']['name'], 'Kyocera M2040')
        self.assertIsNone(deleted['entity']['path'])
        self.save(loaded, name='План с архивными отметками')
        self.save(self.get_floor(), markers=[])
        self.assertEqual(self.get_floor()['markers'], [])

    def test_deleting_floor_checks_revision_preserves_equipment_and_removes_image(self):
        current = self.save(markers=[self.marker()], image=('plan.png', PNG, 'image/png'))
        self.assertEqual(self.client.delete(f"/api/maps/floors/{current['id']}", params={'revision': 1}).status_code, 409)
        self.assertEqual(self.client.delete(f'/api/maps/buildings/{self.building}').status_code, 409)
        self.assertEqual(self.client.delete(f"/api/maps/floors/{current['id']}", params={'revision': current['revision']}).status_code, 204)
        self.assertEqual(self.client.delete(f'/api/maps/buildings/{self.building}').status_code, 204)
        self.assertEqual(list(self.root.rglob('*.png')), [])
        with self.sessions() as db:
            self.assertIsNotNone(db.get(Workplace, self.workplace))
            self.assertIsNotNone(db.get(WarehouseItem, self.asset))
            self.assertEqual(db.query(MapMarker).count(), 0)

    def test_building_branch_cannot_change_with_placed_objects(self):
        self.save(markers=[self.marker()])
        response = self.client.put(f'/api/maps/buildings/{self.building}', json={'name': 'Корпус', 'branch_id': self.other_branch})
        self.assertEqual(response.status_code, 409)

    def test_tables_created_on_existing_database_idempotently(self):
        with self.engine.begin() as connection:
            connection.execute(text('DROP TABLE map_markers'))
            connection.execute(text('DROP TABLE map_floors'))
            connection.execute(text('DROP TABLE map_buildings'))
        with patch('database.engine', self.engine):
            initialize_database()
            initialize_database()
        self.assertIn('map_markers', inspect(self.engine).get_table_names())
        self.assertEqual(self.client.get('/api/maps/catalog').status_code, 200)

    def test_maps_require_authentication(self):
        self.app.dependency_overrides.pop(get_current_user)
        self.assertEqual(self.client.get('/api/maps/buildings').status_code, 401)
        self.assertEqual(self.client.get(f"/api/maps/floors/{self.floor['id']}/background").status_code, 401)


if __name__ == '__main__':
    unittest.main()
