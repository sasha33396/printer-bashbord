import io
import unittest
import zipfile
from datetime import date

import test_manual_inventory as fixtures
from routers import inventory


class WarehouseMacTests(unittest.TestCase):
    setUp = fixtures.ManualInventoryApiTests.setUp
    create_item = fixtures.ManualInventoryApiTests.create_item

    def test_mac_for_any_asset_category_and_workplace(self):
        response = self.client.post('/api/workplaces', json={'name': 'MAC test workplace'})
        self.assertEqual(response.status_code, 201, response.text)
        place = response.json()
        for index, category in enumerate(('Сервера', 'Коммутаторы', 'Мониторы', 'Компьютеры', 'Ноутбуки', 'Телефоны', 'Другое'), 1):
            with self.subTest(category=category):
                # The field is available before a printed inventory label is assigned.
                item = self.create_item(category=category, mac_address=' aa-bb-cc-dd-ee-ff ')
                self.assertIsNone(item['inventory_number'])
                self.assertEqual(item['mac_address'], 'AA:BB:CC:DD:EE:FF')
                path = f"/api/warehouse/items/{item['id']}"
                changed = self.client.put(path, json={'mac_address': '0011.2233.4455', 'inventory_number': f'1-{index:05}'})
                self.assertEqual(changed.status_code, 200, changed.text)
                self.assertEqual(changed.json()['mac_address'], '00:11:22:33:44:55')
                assigned = self.client.post(f"/api/workplaces/{place['id']}/assignments", json={
                    'item_id': item['id'], 'assigned_at': date.today().isoformat(),
                })
                self.assertEqual(assigned.status_code, 201, assigned.text)
                self.assertEqual(assigned.json()['item']['mac_address'], '00:11:22:33:44:55')
                current = self.client.get(f"/api/workplaces/{place['id']}").json()['current_assets']
                self.assertEqual(next(row for row in current if row['item']['id'] == item['id'])['item']['mac_address'], '00:11:22:33:44:55')
                unchanged = self.client.put(path, json={'name': 'Renamed asset'})
                self.assertEqual(unchanged.json()['mac_address'], '00:11:22:33:44:55')
                archive = self.client.get('/api/inventory/archive')
                with zipfile.ZipFile(io.BytesIO(archive.content)) as exported:
                    card = inventory._card_from_text(exported.read(f'1-{index:05}/1-{index:05}.txt'))
                    self.assertEqual(card['data']['mac_address'], '00:11:22:33:44:55')
                cleared = self.client.put(path, json={'mac_address': ''})
                self.assertEqual(cleared.status_code, 200, cleared.text)
                self.assertIsNone(cleared.json()['mac_address'])
                invalid = self.client.put(path, json={'mac_address': 'invalid'})
                self.assertEqual(invalid.status_code, 422)


if __name__ == '__main__':
    unittest.main()
