export const MAP_TOOLS = { select: 'Выбор', pan: 'Перемещение вида', room: 'Комната', wall: 'Стена', door: 'Дверь', text: 'Подпись' }
export const ENTITY_TYPES = { workplace: 'Рабочие места', device: 'Печатающая техника', warehouse_item: 'Оборудование' }
export const ENTITY_COLORS = { workplace: '#1677ff', device: '#722ed1', warehouse_item: '#08979c' }
export const markerKey = (marker) => `${marker.entity_type}:${marker.entity_id}`
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
export const round = (value) => Math.round(value * 100) / 100
export const snap = (value, step) => round(step ? Math.round(value / step) * step : value)
export const pointOnPlan = (point, plan, step) => ({
  x: clamp(snap(point.x, step), 0, plan.width), y: clamp(snap(point.y, step), 0, plan.height),
})
export const newShapeId = () => globalThis.crypto?.randomUUID?.() || `shape-${Date.now()}-${Math.random().toString(36).slice(2)}`

export function shapeFromDrag(kind, start, end, id = newShapeId()) {
  if (kind === 'room') {
    const width = round(Math.abs(end.x - start.x)), height = round(Math.abs(end.y - start.y))
    if (width < 0.5 || height < 0.5) return null
    return { id, kind, x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width, height, label: 'Помещение', color: '#e6f4ff' }
  }
  if (Math.hypot(end.x - start.x, end.y - start.y) < 0.2) return null
  return { id, kind, x: start.x, y: start.y, x2: end.x, y2: end.y, label: '', color: '#e6f4ff' }
}

export function translateElement(element, delta, plan) {
  const maxX = element.kind === 'room' ? element.x + element.width : Math.max(element.x, element.x2 ?? element.x)
  const maxY = element.kind === 'room' ? element.y + element.height : Math.max(element.y, element.y2 ?? element.y)
  const minX = Math.min(element.x, element.x2 ?? element.x), minY = Math.min(element.y, element.y2 ?? element.y)
  const dx = clamp(delta.x, -minX, plan.width - maxX), dy = clamp(delta.y, -minY, plan.height - maxY)
  return { ...element, x: round(element.x + dx), y: round(element.y + dy),
    ...(element.x2 !== undefined ? { x2: round(element.x2 + dx), y2: round(element.y2 + dy) } : {}) }
}

export function documentFromFloor(floor) {
  return {
    name: floor.name, width: floor.width, height: floor.height,
    background_opacity: floor.background_opacity ?? 0.4, remove_background: false,
    shapes: floor.shapes, markers: floor.markers.map(({ entity, ...marker }) => marker),
  }
}

export function historyReducer(state, action) {
  if (action.type === 'reset') return { past: [], present: action.document, future: [] }
  if (action.type === 'undo' && state.past.length) return {
    past: state.past.slice(0, -1), present: state.past.at(-1), future: [state.present, ...state.future],
  }
  if (action.type === 'redo' && state.future.length) return {
    past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1),
  }
  if (action.type === 'commit' && JSON.stringify(action.document) !== JSON.stringify(state.present)) return {
    past: [...state.past.slice(-39), state.present], present: action.document, future: [],
  }
  return state
}

export function filterMapCatalog(catalog, { search = '', type, branchId } = {}) {
  const query = search.trim().toLocaleLowerCase('ru')
  return catalog.filter((item) => (!type || item.entity_type === type)
    && (!branchId || !item.branch_id || branchId === item.branch_id)
    && (!query || [item.name, item.inventory_number, item.employee_name, item.department_name, item.category,
      ...(item.equipment || []).flatMap((asset) => [asset.name, asset.inventory_number])]
      .some((value) => String(value || '').toLocaleLowerCase('ru').includes(query))))
}
