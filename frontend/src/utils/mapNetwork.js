import { clamp, markerKey, newShapeId, round } from './floorPlans.js'

export const NETWORK_KINDS = { switch: 'Коммутатор', router: 'Маршрутизатор', access_point: 'Точка Wi-Fi', patch_panel: 'Патч-панель', socket: 'Сетевая розетка', computer: 'Компьютер', printer: 'Принтер', server: 'Сервер', other: 'Другой узел' }
export const PORT_KINDS = { ethernet: 'Ethernet', fiber: 'Оптика', wireless: 'Wi-Fi', logical: 'Логический' }
export const LINK_MEDIA = { copper: 'Медный кабель', fiber: 'Оптоволокно', wireless: 'Беспроводное', logical: 'Логическое' }
export const LINK_STATES = { installed: 'Подключено по учёту', planned: 'Запланировано', disconnected: 'Отключено по учёту' }
export const EMPTY_NETWORK = { nodes: [], links: [] }
export const portKey = (nodeId, portId) => `${nodeId}:${portId}`

export function generatePorts(count, old = [], paired = false, kind = 'ethernet') {
  const ports = Array.from({ length: count * (paired ? 2 : 1) }, (_, index) => ({
    id: old[index]?.id || newShapeId(), name: paired ? `${Math.floor(index / 2) + 1} · ${index % 2 ? 'задний' : 'передний'}` : String(index + 1),
    kind, notes: old[index]?.notes || '', paired_port_id: null,
  }))
  if (paired) ports.forEach((port, index) => { port.paired_port_id = ports[index % 2 ? index - 1 : index + 1].id })
  return ports
}

export function floorNetwork(document, graph, floor, catalog) {
  const local = floor ? document.network || EMPTY_NETWORK : EMPTY_NETWORK
  const nodes = [...(graph.nodes || []).filter(node => node.floor_id !== floor?.id), ...local.nodes.map(node => ({ ...node, floor_id: floor?.id, floor_name: document.name, building_id: floor?.building_id, building_name: floor?.building_name }))]
  const links = [...(graph.links || []).filter(link => link.floor_id !== floor?.id), ...local.links.map(link => ({ ...link, floor_id: floor?.id, floor_name: document.name }))]
  const entities = new Map(catalog.map(entity => [markerKey(entity), entity]))
  const anchors = new Map()
  const enriched = nodes.map(node => {
    const entity = node.entity_type ? entities.get(`${node.entity_type}:${node.entity_id}`) : null
    const position = entity?.position
    const follows = Boolean(node.follow_equipment && position && position.floor_id === node.floor_id)
    let x = follows ? position.x : node.x, y = follows ? position.y : node.y
    if (follows && position.entity_type === 'workplace') {
      const anchor = `${node.floor_id}:${position.entity_id}`
      const index = anchors.get(anchor) || 0
      anchors.set(anchor, index + 1)
      x += 0.8 + index * 0.9; y += 0.7
    }
    if (node.floor_id === floor?.id) { x = clamp(x, 0, document.width); y = clamp(y, 0, document.height) }
    return { ...node, x, y, entity, ip_address: entity ? entity.ip_address || '' : node.ip_address, mac_address: entity ? entity.mac_address || '' : node.mac_address,
      unavailable: Boolean(node.entity_type && (!entity || entity.available === false)),
      warning: node.follow_equipment && position && position.floor_id !== node.floor_id ? `Учётная отметка оборудования находится: ${position.building_name} · ${position.floor_name}` : null }
  })
  return { nodes: enriched, links, revision: graph.revision || 0 }
}

export function occupiedPorts(links, excludedId) {
  const result = new Set()
  for (const link of links) if (link.id !== excludedId && link.state !== 'disconnected' && ['copper', 'fiber'].includes(link.medium)) {
    result.add(portKey(link.source_node, link.source_port)); result.add(portKey(link.target_node, link.target_port))
  }
  return result
}

// Trace the documented physical topology. Passive panels connect only paired jacks.
export function traceNetwork(network, startId, targetId) {
  const adjacency = new Map(), nodeForVertex = new Map()
  const add = (a, b, linkId = null) => {
    adjacency.set(a, [...(adjacency.get(a) || []), { key: b, linkId }])
    adjacency.set(b, [...(adjacency.get(b) || []), { key: a, linkId }])
  }
  const nodes = new Map(network.nodes.map(node => [node.id, node]))
  for (const node of network.nodes) {
    for (const port of node.ports) {
      const key = portKey(node.id, port.id)
      nodeForVertex.set(key, node.id)
      if (['switch', 'router', 'access_point'].includes(node.kind)) add(key, `hub:${node.id}`)
      if (port.paired_port_id) add(key, portKey(node.id, port.paired_port_id))
    }
    nodeForVertex.set(`hub:${node.id}`, node.id)
  }
  for (const link of network.links) if (link.state === 'installed') add(portKey(link.source_node, link.source_port), portKey(link.target_node, link.target_port), link.id)
  const roots = (nodes.get(startId)?.ports || []).map(port => portKey(startId, port.id))
  const queue = [...roots], visited = new Map(roots.map(key => [key, null]))
  let destination = null
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index], nodeId = nodeForVertex.get(current)
    if (nodeId !== startId && (targetId ? nodeId === targetId : nodes.get(nodeId)?.kind === 'router')) { destination = current; break }
    for (const next of adjacency.get(current) || []) if (!visited.has(next.key)) { visited.set(next.key, { previous: current, linkId: next.linkId }); queue.push(next.key) }
  }
  const nodeIds = new Set([startId]), linkIds = new Set(), steps = []
  if (destination) {
    let current = destination
    while (current) {
      const nodeId = nodeForVertex.get(current)
      if (nodeId) nodeIds.add(nodeId)
      const step = visited.get(current)
      if (step?.linkId) linkIds.add(step.linkId)
      current = step?.previous
    }
    for (const id of [...linkIds].reverse()) steps.push(network.links.find(link => link.id === id))
  }
  return { found: Boolean(destination), nodeIds, linkIds, steps }
}

export function linkPoints(link, nodes, floor, document) {
  const source = nodes.find(node => node.id === link.source_node), target = nodes.find(node => node.id === link.target_node)
  if (!source || !target) return null
  const sourceHere = source.floor_id === floor.id, targetHere = target.floor_id === floor.id
  if (!sourceHere && !targetHere) return null
  const owner = link.floor_id === floor.id
  const local = sourceHere ? source : target, remote = sourceHere ? target : source
  const portal = owner && link.remote_point ? link.remote_point : { x: clamp(local.x + 2, 0, document.width), y: clamp(local.y + 1.5, 0, document.height) }
  const a = sourceHere ? source : portal, b = targetHere ? target : portal
  const route = owner ? link.route || [] : []
  const points = route.length ? [a, ...route, b] : [a, { x: b.x, y: a.y }, b]
  return { points, source, target, remote: sourceHere && targetHere ? null : remote, portal, owner }
}

export function insertRoutePoint(link, geometry, point) {
  const route = link.route?.length ? [...link.route] : geometry.points.slice(1, -1).map(({ x, y }) => ({ x, y }))
  const points = [geometry.points[0], ...route, geometry.points.at(-1)]
  let at = 0, distance = Infinity
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index], b = points[index + 1], dx = b.x - a.x, dy = b.y - a.y
    const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1)
    const gap = Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy)
    if (gap < distance) { at = index; distance = gap }
  }
  route.splice(at, 0, { x: round(point.x), y: round(point.y) })
  return route
}
