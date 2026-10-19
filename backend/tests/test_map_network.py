from copy import deepcopy
import unittest
import test_maps


class NetworkTests(unittest.TestCase):
    setUp = test_maps.MapTests.setUp
    new_floor = test_maps.MapTests.new_floor
    get_floor = test_maps.MapTests.get_floor
    marker = test_maps.MapTests.marker
    save = test_maps.MapTests.save

    def node(self, node_id, **changes):
        return {'id': node_id, 'kind': 'switch', 'name': node_id, 'x': 4, 'y': 5,
                'ports': [dict(id='p1', name='1'), dict(id='p2', name='2')], **changes}

    def link(self, link_id, source, target, **changes):
        return {'id': link_id, 'source_node': source, 'source_port': 'p1',
                'target_node': target, 'target_port': 'p1', **changes}

    def net_save(self, floor, nodes, links=(), status=200, revision=None, **changes):
        return self.save(floor, status=status, network={'nodes': nodes, 'links': list(links)},
                         network_revision=floor['network_revision'] if revision is None else revision, **changes)

    def test_network_saved_with_history_and_legacy_saves_preserve_it(self):
        saved = self.net_save(self.floor, [self.node('sw'), self.node('pc')], [self.link('c1', 'sw', 'pc', route=[{'x': 10, 'y': 3}])])
        self.assertEqual(saved['network_revision'], 1)
        self.assertEqual(len(saved['network']['nodes']), 2)
        legacy = self.save(saved, name='Renamed')
        self.assertEqual(legacy['network'], saved['network'])
        self.assertEqual(legacy['network_revision'], 1)
        version = self.client.get(f"/api/maps/floors/{saved['id']}/versions/{saved['revision']}").json()
        self.assertEqual(version['document']['network'], saved['network'])
        graph = self.client.get('/api/maps/network').json()
        self.assertEqual(graph['nodes'][0]['floor_id'], self.floor['id'])

    def test_cross_floor_port_reservation_and_global_revision(self):
        first = self.net_save(self.floor, [self.node('a')])
        second = self.new_floor('2')
        second = self.net_save(second, [self.node('b'), self.node('c')])
        self.net_save(first, first['network']['nodes'], [self.link('ab', 'a', 'b', remote_point={'x': 30, 'y': 10})], status=409)
        first = self.get_floor(first['id'])
        first = self.net_save(first, first['network']['nodes'], [self.link('ab', 'a', 'b', remote_point={'x': 30, 'y': 10})])
        second = self.get_floor(second['id'])
        self.net_save(second, second['network']['nodes'], [self.link('bc', 'b', 'c')], status=409)
        self.assertEqual(self.get_floor(second['id'])['revision'], second['revision'])
        second = self.net_save(second, second['network']['nodes'], [self.link('bc', 'b', 'c', source_port='p2')])
        self.assertEqual(second['network_revision'], first['network_revision'] + 1)

    def test_foreign_links_block_node_port_and_floor_deletion(self):
        first = self.net_save(self.floor, [self.node('a')])
        second = self.new_floor('2')
        second = self.net_save(second, [self.node('b')], [self.link('ab', 'a', 'b', remote_point={'x': 2, 'y': 2})])
        first = self.get_floor(first['id'])
        self.net_save(first, [], status=409)
        nodes = deepcopy(first['network']['nodes']); nodes[0]['ports'] = [nodes[0]['ports'][1]]
        self.net_save(first, nodes, status=409)
        response = self.client.delete(f"/api/maps/floors/{first['id']}?revision={first['revision']}")
        self.assertEqual(response.status_code, 409, response.text)
        self.net_save(second, second['network']['nodes'])
        first = self.get_floor(first['id'])
        self.assertEqual(self.client.delete(f"/api/maps/floors/{first['id']}?revision={first['revision']}").status_code, 204)

    def test_validation_addresses_pairs_ids_bounds_and_port_medium(self):
        for changes in [dict(ip_address='999.3.4.5'), dict(mac_address='bad'), dict(x=41),
                        dict(ports=[{'id': '1', 'name': '1', 'paired_port_id': 'missing'}]),
                        dict(ports=[{'id': '1', 'name': '1'}, {'id': '1', 'name': '2'}])]:
            self.net_save(self.floor, [self.node('bad', **changes)], status=422)
        self.net_save(self.floor, [self.node('same'), self.node('same')], status=422)
        self.net_save(self.floor, [self.node('a'), self.node('b')], [self.link('x', 'a', 'b', medium='fiber')], status=422)
        good = self.node('panel', kind='patch_panel')
        good['ports'][0]['paired_port_id'] = 'p2'; good['ports'][1]['paired_port_id'] = 'p1'
        self.net_save(self.floor, [good])

    def test_attachment_availability_branch_and_uniqueness(self):
        node = self.node('asset', entity_type='warehouse_item', entity_id=self.asset,ip_address='192.0.2.100')
        saved = self.net_save(self.floor, [node])
        self.assertEqual(saved['network']['nodes'][0]['ip_address'],'')
        second = self.new_floor('2')
        duplicate = self.node('duplicate', entity_type='warehouse_item', entity_id=self.asset)
        self.net_save(second, [duplicate], status=422)
        duplicate['entity_id'] = self.foreign_asset
        self.net_save(second, [duplicate], status=422)
        duplicate['entity_id'] = self.quantity
        self.net_save(second, [duplicate], status=422)
        self.assertEqual(self.get_floor()['network'], saved['network'])
        located=self.client.get(f'/api/maps/locate/warehouse_item/{self.asset}').json()
        self.assertTrue(located['placed'])
        self.assertEqual(located['position']['entity_type'],'network')
        response=self.client.put(f'/api/maps/buildings/{self.building}',json={'name':'Building','branch_id':self.other_branch})
        self.assertEqual(response.status_code,409)
        self.save(saved,markers=[self.marker()])
        located=self.client.get(f'/api/maps/locate/warehouse_item/{self.asset}').json()
        self.assertEqual(located['position']['entity_type'],'workplace')

    def test_network_column_migration_preserves_old_plan_and_is_repeatable(self):
        from database import initialize_database
        from sqlalchemy import text
        from unittest.mock import patch
        saved=self.save(markers=[self.marker()])
        with self.engine.begin() as connection:
            connection.execute(text('ALTER TABLE map_floors DROP COLUMN network_json'))
        with patch('database.engine',self.engine):
            initialize_database();initialize_database()
        current=self.get_floor()
        self.assertEqual(current['network'],{'nodes':[],'links':[]})
        self.assertEqual(current['markers'],saved['markers'])
        self.assertEqual(current['revision'],saved['revision'])

    def test_legacy_resize_cannot_crop_existing_network(self):
        saved=self.net_save(self.floor,[self.node('a',x=30)])
        self.save(saved,width=20,status=422)
        self.assertEqual(self.get_floor()['width'],40)

    def test_disconnected_cable_does_not_reserve_port_and_planned_does(self):
        nodes = [self.node('a'), self.node('b'), self.node('c')]
        links = [self.link('ab','a','b',state='disconnected'), self.link('ac','a','c',state='planned')]
        saved = self.net_save(self.floor,nodes,links)
        links[0]['state'] = 'installed'
        self.net_save(saved,saved['network']['nodes'],links,status=409)

    def test_transaction_rolls_back_floor_and_network_on_invalid_marker(self):
        self.net_save(self.floor,[self.node('a')],markers=[self.marker('device',999999)],status=422)
        self.assertEqual(self.get_floor()['revision'],self.floor['revision'])
        self.assertEqual(self.client.get('/api/maps/network').json()['revision'],0)
