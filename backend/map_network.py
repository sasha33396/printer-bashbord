"""The network is edited with a floor plan; ports are reserved across all floors."""
import json

from fastapi import HTTPException
from models import MapFloor, MapNetworkState

EMPTY_NETWORK = {'nodes': [], 'links': []}


def network_revision(db):
    state = db.get(MapNetworkState, 1)
    return state.revision if state else 0


def read_network(db):
    nodes, links = [], []
    for floor in db.query(MapFloor):
        network = json.loads(floor.network_json)
        location = {'floor_id': floor.id, 'floor_name': floor.name, 'building_id': floor.building_id,
                    'building_name': floor.building.name, 'branch_id': floor.building.branch_id}
        nodes.extend({**node, **location} for node in network['nodes'])
        links.extend({**link, **location} for link in network['links'])
    return {'revision': network_revision(db), 'nodes': nodes, 'links': links}


def update_network(db, floor, plan, expected_revision, entities):
    if plan is None:
        return
    proposed = plan.model_dump()
    for node in proposed['nodes']:
        if node.get('entity_type'):
            node['ip_address'] = node['mac_address'] = ''
    if json.loads(floor.network_json) == proposed:
        return
    if expected_revision is None or expected_revision != network_revision(db):
        raise HTTPException(409, 'Схема сети изменена другим пользователем. Обновите план перед сохранением сети.')
    state = db.get(MapNetworkState, 1)
    if state is None:
        db.add(MapNetworkState(id=1, revision=0)); db.flush()
    if not db.query(MapNetworkState).filter_by(id=1, revision=expected_revision).update({'revision': expected_revision + 1}, synchronize_session=False):
        raise HTTPException(409, 'Схема сети изменена другим пользователем')
    previous = {node['id']: node for node in json.loads(floor.network_json)['nodes']}
    all_plans = [(other.id, proposed if other.id == floor.id else json.loads(other.network_json)) for other in db.query(MapFloor)]
    nodes, links, linked_cards = {}, {}, set()
    for owner_id, network in all_plans:
        for node in network['nodes']:
            if node['id'] in nodes:
                raise HTTPException(422, 'Идентификатор сетевого узла уже используется на другом плане')
            nodes[node['id']] = {**node, 'floor_id': owner_id}
            if node.get('entity_type'):
                key = (node['entity_type'], node['entity_id'])
                if key in linked_cards:
                    raise HTTPException(422, 'Для одной карточки оборудования допускается один сетевой узел')
                linked_cards.add(key)
                if owner_id == floor.id:
                    entity = entities.get(key)
                    old = previous.get(node['id'], {})
                    unchanged = (old.get('entity_type'), old.get('entity_id')) == key
                    if (not entity or not entity['available']) and not unchanged:
                        raise HTTPException(422, 'Нельзя привязать сетевой узел к недоступному оборудованию')
                    if entity and not unchanged and floor.building.branch_id and entity.get('branch_id') not in (None, floor.building.branch_id):
                        raise HTTPException(422, 'Оборудование сетевого узла относится к другому филиалу')
        for link in network['links']:
            if link['id'] in links:
                raise HTTPException(422, 'Идентификатор соединения уже используется')
            links[link['id']] = {**link, 'floor_id': owner_id}
    occupied, endpoint_pairs = set(), set()
    for link in links.values():
        ends = []
        for side in ('source', 'target'):
            node = nodes.get(link[f'{side}_node'])
            if not node:
                raise HTTPException(409, 'На узел ссылается соединение. Сначала удалите его на плане-владельце.')
            port_id = link[f'{side}_port']
            port = next((port for port in node['ports'] if port['id'] == port_id), None)
            if not port:
                raise HTTPException(409, 'Порт используется соединением. Сначала измените или удалите это соединение.')
            if node['floor_id'] == link['floor_id']:
                ends.append(node)
            endpoint = (node['id'], port_id)
            if link['state'] != 'disconnected' and link['medium'] in {'copper', 'fiber'}:
                if endpoint in occupied:
                    raise HTTPException(409, f"Порт «{node['name']} / {port['name']}» уже занят")
                occupied.add(endpoint)
                if port['kind'] != {'copper': 'ethernet', 'fiber': 'fiber'}[link['medium']]:
                    raise HTTPException(422, 'Тип кабеля не соответствует типу порта')
        pair = frozenset(((link['source_node'], link['source_port']), (link['target_node'], link['target_port'])))
        if link['source_node'] == link['target_node'] or pair in endpoint_pairs:
            raise HTTPException(422, 'Нельзя соединить узел с собой или создать повторное соединение')
        endpoint_pairs.add(pair)
        if not ends:
            raise HTTPException(422, 'Хотя бы один конец соединения должен находиться на плане-владельце')
        if len(ends) == 1 and link.get('remote_point') is None:
            raise HTTPException(422, 'Укажите точку перехода соединения на другой этаж')
    floor.network_json = json.dumps(proposed, ensure_ascii=False)


def ensure_floor_can_be_deleted(db, floor):
    node_ids = {node['id'] for node in json.loads(floor.network_json)['nodes']}
    for other in db.query(MapFloor).filter(MapFloor.id != floor.id):
        if any(link['source_node'] in node_ids or link['target_node'] in node_ids for link in json.loads(other.network_json)['links']):
            raise HTTPException(409, 'На этом этаже есть узлы с соединениями на других планах. Сначала отключите эти соединения.')
    if node_ids or json.loads(floor.network_json)['links']:
        state = db.get(MapNetworkState, 1)
        if state: state.revision += 1
        else: db.add(MapNetworkState(id=1, revision=1))
