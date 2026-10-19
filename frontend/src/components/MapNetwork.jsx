import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Checkbox, InputNumber, Popconfirm, Select, Space, Tag, Typography, message } from 'antd'
import { NetworkLinkModal, NetworkNodeModal } from './NetworkForms'
import { EMPTY_NETWORK, floorNetwork, insertRoutePoint, LINK_MEDIA, LINK_STATES, linkPoints, NETWORK_KINDS, occupiedPorts, portKey, traceNetwork } from '../utils/mapNetwork'
import { pointOnPlan } from '../utils/floorPlans'

const codes = { switch: 'SW', router: 'R', access_point: 'AP', patch_panel: 'PP', socket: 'RJ', computer: 'PC', printer: 'PR', server: 'SRV', other: 'N' }

export function NetworkOverlay({ network, floor, document, selected, onSelect, editing, connecting, onChange, mode, group, labels, trace, screenUnit, world, gridStep, interactive = true }) {
  const [drag, setDrag] = useState(null)
  const dragRef=useRef(null)
  const updateDrag=next=>{dragRef.current=next;setDrag(next)}
  useEffect(() => updateDrag(null), [floor.id, editing])
  const nodes = network.nodes.map(node => drag?.kind === 'node' && drag.id === node.id ? { ...node, ...drag.point } : node)
  const links = network.links.map(link => {
    if (drag?.kind !== 'route' || drag.id !== link.id) return link
    return drag.index === 'portal' ? { ...link, remote_point: drag.point } : { ...link, route: link.route.map((point, index) => index === drag.index ? drag.point : point) }
  })
  const nodeId = selected?.startsWith('node:') ? selected.slice(5) : null
  const shownLinks = links.filter(link => (!group || link.group === group || nodes.some(node => [link.source_node,link.target_node].includes(node.id) && node.group === group))
    && (mode === 'all' || mode === 'chain' && trace?.linkIds.has(link.id) || mode === 'selected' && (link.id === selected?.slice(5) || [link.source_node,link.target_node].includes(nodeId))))
  const connected = new Set(shownLinks.flatMap(link => [link.source_node,link.target_node]))
  const size = Math.max(.55, screenUnit * 18)
  const begin = (event, value) => { event.stopPropagation(); event.preventDefault(); event.currentTarget.ownerSVGElement.setPointerCapture(event.pointerId); const origin=world(event);updateDrag({ ...value,origin,point:value.initial||pointOnPlan(origin,document,gridStep),moved:false }) }
  const move = event => { event.stopPropagation();const current=dragRef.current; if (current) {const point=world(event);updateDrag({ ...current,moved:true, point: pointOnPlan(current.initial?{x:current.initial.x+point.x-current.origin.x,y:current.initial.y+point.y-current.origin.y}:point, document, event.altKey ? 0 : gridStep) })} }
  const finish = event => {
    event.stopPropagation()
    const drag=dragRef.current
    if (!drag) return
    if(!drag.moved){updateDrag(null);return}
    if (drag.kind === 'node') onChange({ nodes: (document.network || EMPTY_NETWORK).nodes.map(node => node.id === drag.id ? { ...node, ...drag.point, follow_equipment: false } : node) })
    else onChange({ links: (document.network || EMPTY_NETWORK).links.map(link => link.id !== drag.id ? link : drag.index === 'portal' ? { ...link, remote_point: drag.point } : { ...link, route: link.route.map((point,index) => index === drag.index ? drag.point : point) }) })
    updateDrag(null)
  }
  // Capture on the stable SVG root: moving a bend can replace its rendered handle.
  useEffect(()=>{
    if(!drag)return
    const cancel=event=>{event.stopPropagation();updateDrag(null)}
    window.addEventListener('pointermove',move,true)
    window.addEventListener('pointerup',finish,true)
    window.addEventListener('pointercancel',cancel,true)
    return ()=>{window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',finish,true);window.removeEventListener('pointercancel',cancel,true)}
  },[Boolean(drag),document,world,gridStep])
  return <g className="map-network-layer" pointerEvents={interactive ? undefined : 'none'}>
    {shownLinks.map(link => {
      const geometry = linkPoints(link, nodes, floor, document)
      if (!geometry) return null
      const active = selected === `link:${link.id}`, highlighted = trace?.linkIds.has(link.id)
      const color = active || highlighted ? '#d4380d' : link.state === 'disconnected' ? '#94a3b8' : link.medium === 'fiber' ? '#a855f7' : '#0891b2'
      const middle = geometry.points[Math.floor(geometry.points.length / 2)]
      return <g key={link.id} data-network-link={link.id}>
        <polyline points={geometry.points.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="transparent" strokeWidth={screenUnit * 15}
          onPointerDown={event => { event.stopPropagation(); onSelect(`link:${link.id}`) }}
          onDoubleClick={event => { event.stopPropagation(); if (editing && geometry.owner) onChange({ links: document.network.links.map(row => row.id === link.id ? { ...row, route: insertRoutePoint(link, geometry, pointOnPlan(world(event),document,gridStep)) } : row) }) }} />
        <polyline points={geometry.points.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke={color} strokeWidth={screenUnit * (active || highlighted ? 4 : 2)} strokeDasharray={link.state !== 'installed' || ['wireless','logical'].includes(link.medium) ? `${screenUnit * 7} ${screenUnit * 5}` : undefined} pointerEvents="none" />
        <title>{link.cable_number || 'Без номера'} · {LINK_MEDIA[link.medium]} · {LINK_STATES[link.state]}</title>
        {labels && link.cable_number && <text x={middle.x} y={middle.y - screenUnit * 7} fontSize={screenUnit * 12} fill={color} pointerEvents="none">{link.cable_number}</text>}
        {geometry.remote && <g onPointerDown={event => { event.stopPropagation(); onSelect(`link:${link.id}`) }}>
          <rect x={geometry.portal.x - size / 2} y={geometry.portal.y - size / 2} width={size} height={size} fill="white" stroke={color} strokeWidth={screenUnit * 2} />
          <text x={geometry.portal.x} y={geometry.portal.y + screenUnit * 4} textAnchor="middle" fontSize={screenUnit * 14} fill={color} pointerEvents="none">↗</text>
          {labels && <text x={geometry.portal.x + size} y={geometry.portal.y} fontSize={screenUnit * 11} fill={color} pointerEvents="none">{geometry.remote.floor_name}</text>}
        </g>}
        {editing && active && geometry.owner && <>
          {(link.route || []).map((point,index) => <circle key={index} data-network-bend={index} cx={point.x} cy={point.y} r={screenUnit * 6} fill="white" stroke={color} strokeWidth={screenUnit * 2} onPointerDown={event => begin(event,{ kind: 'route',id:link.id,index })}
            onDoubleClick={event => { event.stopPropagation(); onChange({ links: document.network.links.map(row => row.id === link.id ? { ...row, route: row.route.filter((_,i) => i !== index) } : row) }) }} />)}
          {geometry.remote && <circle cx={geometry.portal.x} cy={geometry.portal.y} r={screenUnit * 7} fill="#d4380d66" onPointerDown={event => begin(event,{ kind:'route',id:link.id,index:'portal' })} />}
        </>}
      </g>
    })}
    {nodes.filter(node => node.floor_id === floor.id && (!group || node.group === group || connected.has(node.id)) && (mode === 'all' || connected.has(node.id) || node.id === nodeId)).map(node => {
      const active = selected === `node:${node.id}`, highlighted = trace?.nodeIds.has(node.id)
      const color = node.unavailable || node.warning ? '#d97706' : active || highlighted ? '#d4380d' : '#0369a1'
      return <g key={node.id} data-network-node={node.id} transform={`translate(${node.x} ${node.y})`} className="floor-plan-object"
        onPointerDown={event => { event.stopPropagation(); onSelect(`node:${node.id}`); if (editing && !connecting && !node.locked) begin(event,{ kind:'node',id:node.id,initial:{x:node.x,y:node.y} }) }}>
        <title>{node.name} · {NETWORK_KINDS[node.kind]}{node.ip_address ? ` · ${node.ip_address}` : ''}</title>
        <rect x={-size / 2} y={-size / 2} width={size} height={size} rx={size / 6} fill="white" stroke={color} strokeWidth={screenUnit * (active ? 3 : 2)} />
        <text textAnchor="middle" y={screenUnit * 4} fontSize={screenUnit * 10} fontWeight={700} fill={color} pointerEvents="none">{codes[node.kind]}</text>
        {labels && <text textAnchor="middle" y={size / 2 + screenUnit * 14} fontSize={screenUnit * 12} fill={color} pointerEvents="none">{node.name}</text>}
      </g>
    })}
  </g>
}

export function useMapNetwork({ document, floor, graph, catalog, editing, saving, onChange, onDeselect, onNavigate, onOpenInspector, focus }) {
  const [enabled, setEnabled] = useState(false), [selected,setSelected] = useState(null)
  const [nodeModal,setNodeModal] = useState(null), [linkModal,setLinkModal] = useState(null)
  const [connecting,setConnecting] = useState(false), [first,setFirst] = useState(null)
  const [mode,setMode] = useState('all'), [group,setGroup] = useState(), [labels,setLabels] = useState(true)
  const [traceStart,setTraceStart] = useState(null), [traceTarget,setTraceTarget] = useState()
  const network = useMemo(() => floorNetwork(document,graph,floor,catalog),[document,graph,floor,catalog])
  const trace = useMemo(() => traceStart ? traceNetwork(network,traceStart,traceTarget) : null,[network,traceStart,traceTarget])
  useEffect(() => { setSelected(null); setConnecting(false); setFirst(null); setTraceStart(null); setMode('all') },[floor?.id])
  useEffect(() => { if (!editing) { setConnecting(false); setNodeModal(null); setLinkModal(null) } },[editing])
  useEffect(() => { if (focus?.key?.startsWith('network:')) { setEnabled(true); setMode('all'); setGroup(undefined); setSelected(`node:${focus.key.slice(8)}`); onOpenInspector() } },[focus])
  const change = changes => onChange({ ...document, network: { ...(document.network || EMPTY_NETWORK), ...changes } })
  const choose = key => {
    onDeselect(); setSelected(key); onOpenInspector()
    if (connecting && key?.startsWith('node:')) {
      const id = key.slice(5)
      if (!first) { setFirst(id); message.info('Выберите второй узел или откройте форму соединения для другого этажа') }
      else if (first !== id) { setLinkModal({ initialSource:first,initialTarget:id }); setConnecting(false); setFirst(null) }
    }
  }
  const node = network.nodes.find(row => selected === `node:${row.id}` && row.floor_id===floor?.id)
  const link = network.links.find(row => selected === `link:${row.id}`)
  const attached = node && network.links.filter(row => [row.source_node,row.target_node].includes(node.id))
  const occupied = occupiedPorts(network.links)
  const groups = [...new Set([...network.nodes,...network.links].map(row => row.group).filter(Boolean))].sort((a,b) => a.localeCompare(b,'ru',{numeric:true}))
  const saveNode = next => { change({ nodes: [...document.network.nodes.filter(row => row.id !== next.id),next] }); choose(`node:${next.id}`) }
  const saveLink = next => { change({ links: [...document.network.links.filter(row => row.id !== next.id),next] }); choose(`link:${next.id}`) }
  const label = id => network.nodes.find(row => row.id === id)?.name || 'Удалённый узел'
  const jump = target => onNavigate(target.floor_id,`network:${target.id}`)
  const inspector = !enabled || !selected || (!node && !link) ? null : <div className="map-inspector network-inspector">
    <Typography.Title level={5}>{node?.name || link?.cable_number || 'Соединение без номера'}</Typography.Title>
    {node ? <>
      <Tag color="blue">{NETWORK_KINDS[node.kind]}</Tag>{node.group && <Tag>{node.group}</Tag>}
      {(node.unavailable || node.warning) && <Alert type="warning" message={node.warning || 'Карточка оборудования недоступна или архивирована'} />}
      <dl className="map-object-details">{Object.entries({ 'IP':node.ip_address,'MAC':node.mac_address,'Имя':node.hostname,'Примечание':node.notes }).filter(([,value]) => value).map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
      {node.entity?.path && <Button onClick={() => window.location.assign(node.entity.path)}>Открыть оборудование</Button>}
      <p><strong>Порты: {node.ports.length}</strong></p>
      <div className="network-inspector-ports">{node.ports.map(port => <div key={port.id}><Tag color={occupied.has(portKey(node.id,port.id)) ? 'cyan' : undefined}>{port.name}</Tag>{occupied.has(portKey(node.id,port.id)) ? 'занят' : 'свободен'}{port.paired_port_id && ` · пара ${node.ports.find(row => row.id === port.paired_port_id)?.name || '?'}`}</div>)}</div>
      <Space wrap><Button onClick={() => { setTraceStart(node.id); setMode('chain'); setGroup(undefined) }}>Показать цепочку</Button>
        {editing && <Button disabled={saving} onClick={() => setNodeModal(node)}>Редактировать узел</Button>}</Space>
      <p>Соединений: {attached.length}</p>{attached.map(row => <Button type="link" key={row.id} onClick={() => choose(`link:${row.id}`)}>{row.cable_number || 'Без номера'} · {label(row.source_node === node.id ? row.target_node : row.source_node)}</Button>)}
      {editing && <Popconfirm title="Удалить узел и его соединения на этом плане?" description="Карточка оборудования сохранится." onConfirm={() => {
        if (attached.some(row => row.floor_id !== floor.id)) return message.error('Сначала удалите соединения на других этажах: откройте их в списке выше.')
        change({ nodes:document.network.nodes.filter(row => row.id !== node.id),links:document.network.links.filter(row => !attached.some(cable => cable.id === row.id)) }); setSelected(null)
      }}><Button danger disabled={saving || node.locked}>Удалить узел</Button></Popconfirm>}
    </> : <>
      <p>{label(link.source_node)} → {label(link.target_node)}</p><Tag>{LINK_MEDIA[link.medium]}</Tag><Tag>{LINK_STATES[link.state]}</Tag>{link.group && <Tag>{link.group}</Tag>}
      <p>{link.notes}</p>
      {[link.source_node,link.target_node].map(id => { const target = network.nodes.find(row => row.id === id); return target && <Button type="link" key={id} onClick={() => target.floor_id === floor.id ? choose(`node:${id}`) : jump(target)}>{target.name} · {target.floor_name}</Button> })}
      {link.floor_id !== floor.id ? <Alert type="info" message="Соединение редактируется на другом плане" action={<Button size="small" onClick={() => onNavigate(link.floor_id,`network:${network.nodes.find(row => [link.source_node,link.target_node].includes(row.id) && row.floor_id === link.floor_id)?.id}`)}>Открыть план</Button>} /> : editing && <>
        <Button disabled={saving} onClick={() => setLinkModal({link})}>Редактировать соединение</Button>
        <p>Двойной щелчок по кабелю добавляет изгиб; по точке — удаляет. Точки и переход ↗ можно перетаскивать.</p>
        {(link.route || []).map((point,index) => <Space key={index} size={4}><span>{index + 1}</span>{['x','y'].map(axis => <InputNumber key={axis} aria-label={`Изгиб ${index + 1} ${axis}`} value={point[axis]} min={0} max={axis === 'x' ? document.width : document.height} step={.1} onChange={value => { if(value != null) change({links:document.network.links.map(row => row.id === link.id ? {...row,route:row.route.map((p,i) => i === index ? {...p,[axis]:value} : p)} : row)}) }} />)}</Space>)}
        <Space wrap><Button disabled={saving} onClick={() => change({links:document.network.links.map(row => row.id === link.id ? {...row,route:[]} : row)})}>Автомаршрут</Button>
          <Popconfirm title="Удалить соединение?" onConfirm={() => { change({links:document.network.links.filter(row => row.id !== link.id)}); setSelected(null) }}><Button danger disabled={saving}>Удалить соединение</Button></Popconfirm></Space>
      </>}
    </>}
  </div>
  return { enabled, selected, clearSelection: () => setSelected(null), nodes:network.nodes,
    nudge:delta=>{if(!node||node.locked||node.floor_id!==floor?.id||!editing||saving)return false;const point=pointOnPlan({x:node.x+delta.x,y:node.y+delta.y},document,0);change({nodes:document.network.nodes.map(row=>row.id===node.id?{...row,...point,follow_equipment:false}:row)});return true},
    toolbar:<><Space wrap className="map-network-toolbar"><Checkbox checked={enabled} onChange={event => setEnabled(event.target.checked)}>Карта сети</Checkbox>
      {enabled && <><Select aria-label="Вид сети" value={mode} onChange={setMode} options={[{value:'all',label:'Вся сеть'},{value:'selected',label:'Связи выбранного узла'},{value:'chain',label:'Цепочка подключения'}]} />
        <Select aria-label="Группа сети" allowClear placeholder="Все группы / VLAN" value={group} onChange={setGroup} options={groups.map(value => ({value,label:value}))} style={{minWidth:160}} />
        <Checkbox checked={labels} onChange={event => setLabels(event.target.checked)}>Подписи сети</Checkbox>
        {editing && <><Button disabled={saving} onClick={() => { setConnecting(false); setNodeModal({}) }}>Добавить узел</Button>
          <Button disabled={saving} type={connecting ? 'primary' : 'default'} onClick={() => { setConnecting(!connecting); setFirst(null); setMode('all') }}>{connecting ? 'Отменить соединение' : 'Соединить узлы'}</Button>
          <Button disabled={saving || network.nodes.length < 2} onClick={() => { setLinkModal({initialSource:first || node?.id}); setConnecting(false); setFirst(null) }}>Выбрать узлы и порты</Button></>}
      </>}
    </Space>
    {enabled && mode === 'chain' && <Space wrap><Select aria-label="Начало цепочки" placeholder="Начальный узел" value={traceStart || undefined} onChange={setTraceStart} style={{minWidth:200}} options={network.nodes.map(row => ({value:row.id,label:`${row.name} · ${row.floor_name}`}))} />
      <Select aria-label="Конец цепочки" allowClear placeholder="До ближайшего маршрутизатора" value={traceTarget} onChange={setTraceTarget} style={{minWidth:260}} options={network.nodes.filter(row => row.id !== traceStart).map(row => ({value:row.id,label:row.name}))} />
      {trace && <Tag color={trace.found ? 'green' : 'orange'}>{trace.found ? `Цепочка по схеме: ${trace.steps.length} соединений` : 'Цепочка по схеме не найдена'}</Tag>}
      {trace?.steps.map(row => <Button size="small" key={row.id} onClick={() => row.floor_id === floor.id ? choose(`link:${row.id}`) : onNavigate(row.floor_id,`network:${network.nodes.find(node=>[row.source_node,row.target_node].includes(node.id)&&node.floor_id===row.floor_id)?.id}`)}>{row.cable_number || label(row.source_node)}</Button>)}
    </Space>}
    <NetworkNodeModal open={Boolean(nodeModal)} node={nodeModal?.id ? nodeModal : null} floor={floor || {}} network={network} catalog={catalog} onClose={() => setNodeModal(null)} onSave={saveNode} />
    <NetworkLinkModal open={Boolean(linkModal)} {...linkModal} floor={floor || {}} network={network} onClose={() => setLinkModal(null)} onSave={saveLink} />
    </>, inspector,
    overlay: enabled && floor ? props => <NetworkOverlay {...props} network={network} floor={floor} document={document} selected={selected} onSelect={choose} editing={editing && !saving} connecting={connecting} onChange={change} mode={mode} group={group} labels={labels} trace={trace} /> : null,
  }
}
