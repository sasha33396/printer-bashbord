import test from 'node:test'
import assert from 'node:assert/strict'
import { documentFromFloor, filterMapCatalog, historyReducer, markerKey, pointOnPlan, shapeFromDrag, translateElement } from '../src/utils/floorPlans.js'

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
