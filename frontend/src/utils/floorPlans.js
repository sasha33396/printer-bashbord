export const MAP_TOOLS = { select: 'Выбор', pan: 'Перемещение вида', room: 'Кабинет', wall: 'Стена', door: 'Дверь', desk: 'Стол', text: 'Подпись' }
export const ENTITY_TYPES = { workplace: 'Рабочие места', employee: 'Сотрудники', device: 'Печатающая техника', warehouse_item: 'Оборудование', room: 'Кабинеты' }
export const ENTITY_COLORS = { workplace: '#1677ff', employee: '#d46b08', device: '#722ed1', warehouse_item: '#08979c', room: '#64748b' }
export const markerKey = (marker) => `${marker.entity_type}:${marker.entity_id}`
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
export const round = (value) => Math.round(value * 100) / 100
export const snap = (value, step) => round(step ? Math.round(value / step) * step : value)
export const pointOnPlan = (point, plan, step) => ({
  x: clamp(snap(point.x, step), 0, plan.width), y: clamp(snap(point.y, step), 0, plan.height),
})
export const newShapeId = () => globalThis.crypto?.randomUUID?.() || `shape-${Date.now()}-${Math.random().toString(36).slice(2)}`

export function shapeFromDrag(kind, start, end, id = newShapeId()) {
  if (['room', 'desk'].includes(kind)) {
    const width = round(Math.abs(end.x - start.x)), height = round(Math.abs(end.y - start.y))
    if (width < 0.5 || height < 0.5) return null
    return { id, kind, x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width, height, label: kind === 'desk' ? '' : 'Помещение', color: kind === 'desk' ? '#f1e6d6' : '#e6f4ff' }
  }
  if (Math.hypot(end.x - start.x, end.y - start.y) < 0.2) return null
  return { id, kind, x: start.x, y: start.y, x2: end.x, y2: end.y, label: '', color: '#e6f4ff' }
}

export function translateElement(element, delta, plan) {
  const maxX = ['room', 'desk'].includes(element.kind) ? element.x + element.width : Math.max(element.x, element.x2 ?? element.x)
  const maxY = ['room', 'desk'].includes(element.kind) ? element.y + element.height : Math.max(element.y, element.y2 ?? element.y)
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
    network: floor.network || { nodes: [], links: [] }, network_revision: floor.network_revision ?? 0,
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

export const roomTitle = (room) => [room.number ? `Кабинет ${room.number}` : '', room.label].filter(Boolean).join(' · ') || 'Кабинет'
export const elementKey = (element) => element.entity_type ? `m:${markerKey(element)}` : `s:${element.id}`
export const containsPoint = (room, point) => room.x <= point.x && room.y <= point.y && room.x + room.width >= point.x && room.y + room.height >= point.y
export function roomAt(document, point) {
  return document.shapes.filter(room => room.kind === 'room' && containsPoint(room, point))
    .sort((a, b) => a.width * a.height - b.width * b.height)[0] || null
}
export function bindRooms(document) {
  return { ...document, markers: document.markers.map(marker => {
    const explicit = document.shapes.find(room => room.kind === 'room' && room.id === marker.room_id && containsPoint(room, marker))
    return { ...marker, room_id: (explicit || roomAt(document, marker))?.id || null }
  }) }
}
export function roomContents(document, room, entities) {
  const members = document.markers.filter(marker => (marker.room_id ? marker.room_id === room.id : roomAt(document, marker)?.id === room.id))
    .map(marker => entities[markerKey(marker)]).filter(Boolean)
  const workplaces = members.filter(entity => entity.entity_type === 'workplace')
  const devices = members.filter(entity => entity.entity_type === 'device')
  const equipment = new Map()
  for (const member of members) {
    if (member.entity_type === 'warehouse_item') equipment.set(member.entity_id, member)
    for (const asset of member.equipment || []) equipment.set(asset.id, asset)
  }
  return { workplaces, devices, equipment: [...equipment.values()] }
}
export function mapSummary(document, entities) {
  const members = document.markers.map(marker => entities[markerKey(marker)]).filter(entity => entity && entity.available !== false)
  return {
    rooms: document.shapes.filter(shape => shape.kind === 'room').length,
    workplaces: members.filter(entity => entity.entity_type === 'workplace').length,
    employees: new Set(members.filter(entity => entity.entity_type === 'workplace' && entity.employee_name).map(entity => entity.employee_id || entity.employee_name)).size,
    vacant: members.filter(entity => entity.entity_type === 'workplace' && entity.status === 'vacant').length,
    printers: members.filter(entity => entity.entity_type === 'device' && entity.device_type !== 'scanner').length,
  }
}
export function markerColor(marker, entity, statuses) {
  if (entity?.available === false || entity?.placement_warning) return '#94a3b8'
  if (statuses && entity?.entity_type === 'workplace') {
    if (entity.status === 'vacant') return '#16a34a'
    if (entity.status === 'inactive') return '#64748b'
  }
  if (statuses && entity?.entity_type === 'device' && entity.status === 'repair') return '#dc2626'
  return ENTITY_COLORS[marker.entity_type]
}
export function draftPositions(entities, document, floor, building) {
  if (!floor) return Object.values(entities)
  const markers = new Map(document.markers.map(marker => [markerKey(marker), marker]))
  const network = new Map((document.network?.nodes || []).filter(node=>node.entity_type).map(node=>[markerKey(node),node]))
  const cache = new Map()
  const resolve = (key, seen = new Set()) => {
    if (cache.has(key)) return cache.get(key)
    if (seen.has(key)) return null
    const entity = entities[key]
    if (!entity) return null
    if (entity.entity_type === 'room') return entity.position || null
    const marker = markers.get(key)
    let position = null
    if (marker) position = { floor_id: floor.id, floor_name: document.name, building_id: floor.building_id,
      building_name: building?.name, branch_id: building?.branch_id, revision: floor.revision,
      entity_type: marker.entity_type, entity_id: marker.entity_id, x: marker.x, y: marker.y, inherited: false }
    else if (entity.position && !entity.position.inherited && entity.position.floor_id !== floor.id) position = entity.position
    else if (entity.placement_target) {
      const parent = resolve(markerKey(entity.placement_target), new Set([...seen, key]))
      if (parent) position = { ...parent, inherited: true }
    }
    if(!position && network.has(key)){
      const node=network.get(key)
      position={floor_id:floor.id,floor_name:document.name,building_id:floor.building_id,building_name:building?.name,branch_id:building?.branch_id,revision:floor.revision,
        entity_type:'network',entity_id:node.id,x:node.x,y:node.y,inherited:false}
    }
    if (!position && !entity.placement_target && entity.position?.floor_id !== floor.id) position = entity.position || null
    cache.set(key, position)
    return position
  }
  return Object.values(entities).map(entity => ({ ...entity, position: resolve(markerKey(entity)) }))
}
export function expandedSelection(document, keys) {
  const elements = [...document.shapes, ...document.markers]
  const selected = new Set(keys)
  const groups = new Set(elements.filter(item => selected.has(elementKey(item)) && item.group_id).map(item => item.group_id))
  for (const item of elements) if (item.group_id && groups.has(item.group_id)) selected.add(elementKey(item))
  const rooms = document.shapes.filter(item => item.kind === 'room' && !item.locked && selected.has(elementKey(item)))
  for (const marker of document.markers) if (rooms.some(room => marker.room_id ? marker.room_id === room.id : roomAt(document, marker)?.id === room.id)) selected.add(elementKey(marker))
  return [...selected]
}
export function moveSelection(document, keys, delta) {
  const selected = new Set(expandedSelection(document, keys))
  const elements = [...document.shapes, ...document.markers].filter(item => selected.has(elementKey(item)) && !item.locked)
  if (!elements.length) return document
  // A common delta keeps the whole group intact when it hits a plan boundary.
  const minX = Math.min(...elements.map(item => Math.min(item.x, item.x2 ?? item.x)))
  const minY = Math.min(...elements.map(item => Math.min(item.y, item.y2 ?? item.y)))
  const maxX = Math.max(...elements.map(item => item.width ? item.x + item.width : Math.max(item.x, item.x2 ?? item.x)))
  const maxY = Math.max(...elements.map(item => item.height ? item.y + item.height : Math.max(item.y, item.y2 ?? item.y)))
  const movement = { x: clamp(delta.x, -minX, document.width - maxX), y: clamp(delta.y, -minY, document.height - maxY) }
  const move = item => selected.has(elementKey(item)) && !item.locked ? translateElement(item, movement, document) : item
  return bindRooms({ ...document, shapes: document.shapes.map(move), markers: document.markers.map(move) })
}
export function snapToWall(point, shapes, distance = 0.35) {
  let closest = point, best = distance
  for (const wall of shapes.filter(shape => shape.kind === 'wall')) {
    const dx = wall.x2 - wall.x, dy = wall.y2 - wall.y, length = dx * dx + dy * dy
    if (!length) continue
    const t = clamp(((point.x - wall.x) * dx + (point.y - wall.y) * dy) / length, 0, 1)
    const candidate = { x: round(wall.x + t * dx), y: round(wall.y + t * dy) }
    const gap = Math.hypot(point.x - candidate.x, point.y - candidate.y)
    if (gap <= best) { closest = candidate; best = gap }
  }
  return closest
}
export function copySelection(document, keys) {
  const selected = new Set(expandedSelection(document, keys))
  return document.shapes.filter(shape => selected.has(elementKey(shape))).map(shape => ({ ...shape }))
}
export function pasteShapes(document, clipboard) {
  if (!clipboard?.length) return { document, keys: [] }
  const groups = new Map()
  const shapes = clipboard.map(shape => {
    if (shape.group_id && !groups.has(shape.group_id)) groups.set(shape.group_id, newShapeId())
    return { ...shape, id: newShapeId(), number: '', locked: false, group_id: groups.get(shape.group_id) || null }
  })
  const draft = { ...document, shapes: [...document.shapes, ...shapes] }
  const keys = shapes.map(elementKey)
  const moved = moveSelection({ ...draft, markers: [] }, keys, { x: 1, y: 1 })
  return { document: bindRooms({ ...draft, shapes: moved.shapes }), keys }
}
export function groupSelection(document, keys, groupId) {
  const selected = new Set(keys)
  const change = item => selected.has(elementKey(item)) && !item.locked ? { ...item, group_id: groupId } : item
  return { ...document, shapes: document.shapes.map(change), markers: document.markers.map(change) }
}
export function alignSelection(document, keys, axis) {
  const selected = new Set(keys)
  const items = [...document.shapes, ...document.markers].filter(item => selected.has(elementKey(item)) && !item.locked)
  if (items.length < 2) return document
  const target = Math.min(...items.map(item => item[axis]))
  const movement = item => ({ x: axis === 'x' ? target - item.x : 0, y: axis === 'y' ? target - item.y : 0 })
  const align = item => {
    if (item.locked) return item
    if (selected.has(elementKey(item))) return translateElement(item, movement(item), document)
    if (item.entity_type) {
      const room = document.shapes.find(shape => shape.kind === 'room' && selected.has(elementKey(shape)) && !shape.locked && (item.room_id ? item.room_id === shape.id : roomAt(document, item)?.id === shape.id))
      if (room) return translateElement(item, movement(room), document)
    }
    return item
  }
  return bindRooms({ ...document, shapes: document.shapes.map(align), markers: document.markers.map(align) })
}
