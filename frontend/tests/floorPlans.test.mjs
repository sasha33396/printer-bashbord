import test from 'node:test'
import assert from 'node:assert/strict'
import { alignSelection, bindRooms, copySelection, documentFromFloor, draftPositions, expandedSelection, filterMapCatalog, groupSelection, historyReducer, mapSummary, markerColor, markerKey, moveSelection, pasteShapes, pointOnPlan, roomAt, roomContents, shapeFromDrag, snapToWall, translateElement } from '../src/utils/floorPlans.js'

test('drawing backwards normalizes room bounds and rejects accidental clicks', () => {
  const room = shapeFromDrag('room', { x: 10, y: 9 }, { x: 2, y: 3 }, 'room')
  assert.deepEqual({ x: room.x, y: room.y, width: room.width, height: room.height }, { x: 2, y: 3, width: 8, height: 6 })
  assert.equal(shapeFromDrag('room', { x: 1, y: 1 }, { x: 1.1, y: 1.1 }), null)
  assert.equal(shapeFromDrag('wall', { x: 1, y: 1 }, { x: 1, y: 1 }), null)
})

test('dragging walls and rooms clamps the whole shape without distortion', () => {
  const plan = { width: 20, height: 10 }
  const wall = { kind: 'wall', x: 9, y: 8, x2: 3, y2: 2 }
  assert.deepEqual(translateElement(wall, { x: 100, y: -100 }, plan), { kind: 'wall', x: 20, y: 6, x2: 14, y2: 0 })
  const room = { kind: 'room', x: 2, y: 2, width: 5, height: 4 }
  assert.deepEqual(translateElement(room, { x: 100, y: 100 }, plan), { kind: 'room', x: 15, y: 6, width: 5, height: 4 })
  assert.deepEqual(pointOnPlan({ x: -5, y: 9.8 }, plan, 0.5), { x: 0, y: 10 })
})

test('undo restores deleted markers and redraw clears redo without changing server revisions', () => {
  const original = { shapes: [], markers: [{ entity_type: 'workplace', entity_id: 4, x: 1, y: 1 }] }
  let state = { past: [], present: original, future: [] }
  state = historyReducer(state, { type: 'commit', document: { ...original, markers: [] } })
  state = historyReducer(state, { type: 'undo' })
  assert.equal(state.present.markers.length, 1)
  assert.equal(markerKey(state.present.markers[0]), 'workplace:4')
  state = historyReducer(state, { type: 'commit', document: { ...original, name: 'Этаж' } })
  assert.equal(state.future.length, 0)
  state = historyReducer(state, { type: 'reset', document: original })
  assert.equal(state.past.length, 0)
})

test('catalog search includes employees and equipment attached to a workplace', () => {
  const catalog = [{ entity_type: 'workplace', entity_id: 1, name: 'РМ-1', employee_name: 'Иванова Анна', branch_id: 1,
    equipment: [{ name: 'Монитор', inventory_number: '1-00401' }] },
  { entity_type: 'device', entity_id: 2, name: 'Принтер', branch_id: 2, equipment: [] }]
  assert.equal(filterMapCatalog(catalog, { search: 'ИВАНОВА' }).length, 1)
  assert.equal(filterMapCatalog(catalog, { search: '1-00401' }).length, 1)
  assert.equal(filterMapCatalog(catalog, { branchId: 1, type: 'device' }).length, 0)
})

test('editable floor strips live entity details and keeps only positions', () => {
  const document = documentFromFloor({ name: 'Этаж', width: 20, height: 10, shapes: [], revision: 7,
    markers: [{ entity_type: 'device', entity_id: 3, x: 5, y: 5, rotation: 90, entity: { name: 'Принтер' } }] })
  assert.equal(document.markers[0].entity, undefined)
  assert.equal(document.revision, undefined)
  assert.equal(document.background_opacity, 0.4)
})

const planFixture = () => bindRooms({ width: 30, height: 20, shapes: [
  { id: 'room', kind: 'room', x: 1, y: 1, width: 10, height: 10, number: '101', label: 'ИТ' },
  { id: 'desk', kind: 'desk', x: 3, y: 4, width: 2, height: 1 },
  { id: 'wall', kind: 'wall', x: 1, y: 1, x2: 11, y2: 1, locked: true },
], markers: [{ entity_type: 'workplace', entity_id: 1, x: 5, y: 6 }, { entity_type: 'device', entity_id: 2, x: 15, y: 12 }] })

test('room membership follows geometry, preserves a valid explicit room and clears deleted references', () => {
  const plan = planFixture()
  assert.equal(plan.markers[0].room_id, 'room')
  assert.equal(plan.markers[1].room_id, null)
  assert.equal(bindRooms({ ...plan, shapes: [] }).markers[0].room_id, null)
  const inner = { id: 'inner', kind: 'room', x: 4, y: 5, width: 2, height: 2 }
  assert.equal(roomAt({ ...plan, shapes: [...plan.shapes, inner] }, plan.markers[0]).id, 'inner')
  assert.equal(bindRooms({ ...plan, shapes: [...plan.shapes, inner] }).markers[0].room_id, 'room')
})

test('moving a room carries its inventory marks, respects locks and keeps a group intact at boundaries', () => {
  const plan = planFixture()
  const moved = moveSelection(plan, ['s:room'], { x: 100, y: 100 })
  assert.deepEqual([moved.shapes[0].x, moved.shapes[0].y], [20, 10])
  assert.deepEqual([moved.markers[0].x, moved.markers[0].y], [24, 15])
  assert.equal(moved.markers[0].room_id, 'room')
  assert.deepEqual(moved.shapes[2], plan.shapes[2])
  const grouped = groupSelection(plan, ['s:desk', 'm:device:2'], 'group')
  assert.ok(expandedSelection(grouped, ['s:desk']).includes('m:device:2'))
  const groupMoved = moveSelection(grouped, ['s:desk'], { x: -100, y: -100 })
  assert.equal(groupMoved.markers[1].x - groupMoved.shapes[1].x, 12)
  assert.equal(groupMoved.markers[1].y - groupMoved.shapes[1].y, 8)
  assert.equal(moveSelection(plan, ['s:wall'], { x: 5, y: 0 }), plan)
})

test('copying room and desk creates new shape IDs without duplicating or moving inventory records', () => {
  const plan = planFixture()
  const result = pasteShapes(plan, copySelection(plan, ['s:room', 's:desk']))
  assert.equal(result.document.shapes.length, 5)
  assert.equal(new Set(result.document.shapes.map(shape => shape.id)).size, 5)
  assert.equal(result.document.shapes[3].number, '')
  assert.equal(result.document.shapes[3].x, 2)
  assert.deepEqual(result.document.markers, plan.markers)
  assert.equal(copySelection(plan, ['m:workplace:1']).length, 0)
})

test('alignment works for selected elements and wall snapping uses the nearest segment', () => {
  const plan = planFixture()
  const aligned = alignSelection(plan, ['s:desk', 'm:device:2'], 'y')
  assert.equal(aligned.shapes[1].y, 4)
  assert.equal(aligned.markers[1].y, 4)
  assert.deepEqual(snapToWall({ x: 4, y: 1.2 }, plan.shapes), { x: 4, y: 1 })
  assert.deepEqual(snapToWall({ x: 4, y: 4 }, plan.shapes), { x: 4, y: 4 })
})

test('room cards deduplicate linked assets and floor counts use actual occupants and device types', () => {
  const plan = planFixture()
  plan.markers.push({ entity_type: 'warehouse_item', entity_id: 3, x: 4, y: 4, room_id: 'room' })
  const entities = {
    'workplace:1': { entity_type: 'workplace', entity_id: 1, status: 'vacant', employee_id: 7, employee_name: 'Иванов', equipment: [{ id: 3, name: 'Монитор' }] },
    'device:2': { entity_type: 'device', entity_id: 2, device_type: 'scanner', status: 'repair' },
    'warehouse_item:3': { entity_type: 'warehouse_item', entity_id: 3, name: 'Монитор' },
  }
  const contents = roomContents(plan, plan.shapes[0], entities)
  assert.equal(contents.workplaces.length, 1)
  assert.equal(contents.equipment.length, 1)
  assert.deepEqual(mapSummary(plan, entities), { rooms: 1, workplaces: 1, employees: 1, vacant: 1, printers: 0 })
  assert.equal(markerColor(plan.markers[0], entities['workplace:1'], true), '#16a34a')
  assert.equal(markerColor(plan.markers[1], entities['device:2'], true), '#dc2626')
  assert.equal(markerColor(plan.markers[1], { ...entities['device:2'], available: false }, true), '#94a3b8')
})

test('global catalog supports employee and cabinet types without restricting another building', () => {
  const catalog = [
    { entity_type: 'employee', entity_id: 1, name: 'Иванова Анна', branch_id: 2 },
    { entity_type: 'room', entity_id: '2:cabinet', name: 'Кабинет 205', employee_name: 'Иванова Анна', branch_id: 2, equipment: [{ inventory_number: '1-00401' }] },
  ]
  assert.equal(filterMapCatalog(catalog, { type: 'employee', search: 'ИВАНОВА' }).length, 1)
  assert.equal(filterMapCatalog(catalog, { search: '205' })[0].entity_type, 'room')
  assert.equal(filterMapCatalog(catalog, { search: '1-00401' })[0].entity_type, 'room')
})

test('draft placement immediately locates employees and linked equipment without extra markers', () => {
  const plan = planFixture()
  const entities = {
    'workplace:1': { entity_type: 'workplace', entity_id: 1, name: 'РМ-1', position: null },
    'employee:7': { entity_type: 'employee', entity_id: 7, name: 'Иванов', placement_target: { entity_type: 'workplace', entity_id: 1 }, position: null },
    'warehouse_item:3': { entity_type: 'warehouse_item', entity_id: 3, name: 'Монитор', placement_target: { entity_type: 'workplace', entity_id: 1 }, position: null },
  }
  const positioned = draftPositions(entities, plan, { id: 1, revision: 2 }, { name: 'Корпус' })
  assert.equal(positioned[1].position.entity_type, 'workplace')
  assert.equal(positioned[1].position.inherited, true)
  assert.equal(positioned[2].position.x, 5)
  const removed = draftPositions(entities, { ...plan, markers: [] }, { id: 1, revision: 2 }, {})
  assert.equal(removed[1].position, null)
  const direct = { floor_id: 9, entity_type: 'warehouse_item', entity_id: 3, inherited: false }
  entities['warehouse_item:3'].position = direct
  assert.equal(draftPositions(entities, plan, { id: 1 }, {})[2].position, direct)
  const cabinetPosition = { floor_id: 1, entity_type: 'room', entity_id: 'room' }
  const rooms = draftPositions({ 'room:1:room': { entity_type: 'room', entity_id: '1:room', position: cabinetPosition } }, plan, { id: 1 }, {})
  assert.equal(rooms[0].position, cabinetPosition)
})
