import { useEffect, useRef, useState } from 'react'
import { Button, Space, Tooltip, Typography } from 'antd'
import { AimOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons'
import { clamp, ENTITY_COLORS, markerColor, markerKey, moveSelection, newShapeId, pointOnPlan, roomTitle, round, shapeFromDrag, snap, snapToWall, translateElement } from '../utils/floorPlans'
import { bounds, marqueeSelection, resizeRectangle, smartGuides, wallDistances } from '../utils/mapEditing'

const itemForKey = (document, key) => key?.startsWith('s:')
  ? document.shapes.find((item) => `s:${item.id}` === key)
  : document.markers.find((item) => `m:${markerKey(item)}` === key)

export default function FloorPlanCanvas({ floorId, document, onChange, editing, saving, tool, onToolChange,
  selected, selection = [], onSelect, pendingEntity, onPlaced, entities, backgroundUrl, showGrid, gridStep, focus, onOpen,
  visibleTypes = ['workplace', 'device', 'warehouse_item', 'employee'], showLabels = true, highlightStatuses = false, wallSnap = false,
  networkLayer, networkNodes = [], smartSnap = true, measurements = false, showRoomDimensions = false, reference, onSelection }) {
  const svgRef = useRef(null)
  const gestureRef = useRef(null)
  const [gesture, setGesture] = useState(null)
  const [measurement,setMeasurement] = useState(null)
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 580 })
  const [view, setViewState] = useState({ x: 0, y: 0, width: document.width, height: document.height })
  const viewRef = useRef(view)
  const setView = (next) => { viewRef.current = next; setViewState(next) }
  const updateGesture = (next) => { gestureRef.current = next; setGesture(next) }
  const fit = () => setView({ x: 0, y: 0, width: document.width, height: document.height })
  useEffect(() => { fit(); updateGesture(null) }, [floorId, document.width, document.height])
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setCanvasSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(svgRef.current)
    return () => observer.disconnect()
  }, [])
  const screenUnit = Math.max(view.width / Math.max(canvasSize.width, 1), view.height / Math.max(canvasSize.height, 1))
  useEffect(() => {
    if (!focus?.key) return
    const room = focus.key.startsWith('room:') ? document.shapes.find(item => item.id === focus.key.slice(5)) : null
    const marker = document.markers.find((item) => markerKey(item) === focus.key)
    const node = focus.key.startsWith('network:') ? networkNodes.find(item => item.id === focus.key.slice(8) && item.floor_id === floorId) : null
    const item = room || marker || node
    if (!item) return
    const width = Math.min(document.width, room ? room.width + 4 : 12)
    const height = Math.max(width * document.height / document.width, room ? room.height + 4 : 0)
    setView({ x: item.x + (room?.width || 0) / 2 - width / 2, y: item.y + (room?.height || 0) / 2 - height / 2, width, height })
    if(!node) onSelect(room ? `s:${room.id}` : `m:${focus.key}`)
  }, [focus, floorId])

  const zoom = (factor, anchor) => {
    const previous = viewRef.current
    const width = clamp(previous.width / factor, document.width / 8, document.width * 2)
    const ratio = width / previous.width
    const center = anchor || { x: previous.x + previous.width / 2, y: previous.y + previous.height / 2 }
    setView({ x: center.x - (center.x - previous.x) * ratio, y: center.y - (center.y - previous.y) * ratio,
      width, height: previous.height * ratio })
  }
  const world = (event) => {
    const point = svgRef.current.createSVGPoint()
    point.x = event.clientX; point.y = event.clientY
    const matrix = svgRef.current.getScreenCTM()
    const value=matrix ? point.matrixTransform(matrix.inverse()) : { x: 0, y: 0 }
    return {x:value.x,y:value.y}
  }
  useEffect(() => {
    const svg = svgRef.current
    const wheel = (event) => { event.preventDefault(); zoom(event.deltaY < 0 ? 1.12 : 1 / 1.12, world(event)) }
    svg.addEventListener('wheel', wheel, { passive: false })
    return () => svg.removeEventListener('wheel', wheel)
  }, [document.width, document.height])

  const start = (event) => {
    if (saving || (event.button !== 0 && event.button !== 1)) return
    svgRef.current.focus()
    event.preventDefault()
    if (event.button === 1 || tool === 'pan' || (!editing && !event.target.closest('[data-map-key]'))) {
      updateGesture({ kind: 'pan', screen: { x: event.clientX, y: event.clientY }, view: viewRef.current,
        matrix: svgRef.current.getScreenCTM().inverse() })
    } else if (tool === 'measure') {
      updateGesture({kind:'measure',start:world(event),end:world(event)})
    } else if (editing && pendingEntity) {
      const point = pointOnPlan(world(event), document, gridStep)
      onPlaced(pendingEntity, point)
      return
    } else if (editing && ['room', 'wall', 'door', 'desk'].includes(tool)) {
      const raw = pointOnPlan(world(event), document, gridStep)
      const point = wallSnap ? snapToWall(raw, document.shapes) : raw
      updateGesture({ kind: 'draw', tool, start: point, end: point, id: newShapeId() })
    } else if (editing && tool === 'text') {
      const item = { id: newShapeId(), kind: 'text', ...pointOnPlan(world(event), document, gridStep), label: 'Подпись', color: '#334155' }
      onChange({ ...document, shapes: [...document.shapes, item] })
      onSelect(`s:${item.id}`)
      onToolChange('select')
      return
    } else {
      const target = event.target.closest('[data-map-key]')
      const key = target?.getAttribute('data-map-key')
      const resizing=target?.hasAttribute('data-resize')
      const item = itemForKey(document, key)
      // A room's empty interior can start a selection box; select the room first to move it.
      if (editing && tool === 'select' && (!key || item?.kind === 'room' && !selection.includes(key))) {
        updateGesture({kind:'marquee',start:world(event),end:world(event),additive:event.shiftKey,clickKey:key || null})
      } else {
        onSelect(key || null, { additive: editing && event.shiftKey && !resizing, keep: selection.includes(key) && !event.shiftKey })
        if (key && editing && (!event.shiftKey || resizing) && !item?.locked) updateGesture({ kind: resizing ? 'resize' : target.hasAttribute('data-end') ? 'end' : 'drag',
          key, keys: selection.includes(key) ? selection : [key], start: world(event), end: world(event), item, handle:target.getAttribute('data-resize'),alt:event.altKey,shift:event.shiftKey })
      }
    }
    if (gestureRef.current) svgRef.current.setPointerCapture(event.pointerId)
  }
  const move = (event) => {
    const current = gestureRef.current
    if (!current) return
    if (current.kind === 'pan') {
      const dx = event.clientX - current.screen.x, dy = event.clientY - current.screen.y
      setView({ ...current.view, x: current.view.x - dx * current.matrix.a - dy * current.matrix.c,
        y: current.view.y - dx * current.matrix.b - dy * current.matrix.d })
    } else {
      let end = current.kind === 'draw' ? pointOnPlan(world(event), document, gridStep) : world(event)
      if (wallSnap && !event.altKey && ['draw', 'end'].includes(current.kind)) end = snapToWall(end, document.shapes)
      updateGesture({ ...current, end,alt:event.altKey,shift:event.shiftKey })
    }
  }
  const modifiedItem = (current) => {
    const { item, end } = current
    if (current.kind === 'resize') return resizeRectangle(item,current.handle || 'se',pointOnPlan(end,document,current.alt ? 0 : gridStep),document,current.shift)
    if (current.kind === 'end') return { ...item, x2: pointOnPlan(end, document, gridStep).x, y2: pointOnPlan(end, document, gridStep).y }
    return translateElement(item, { x: snap(end.x - current.start.x, gridStep), y: snap(end.y - current.start.y, gridStep) }, document)
  }
  const dragMovement = current => {
    let delta={x:snap(current.end.x-current.start.x,current.alt?0:gridStep),y:snap(current.end.y-current.start.y,current.alt?0:gridStep)}
    let guides=[]
    if(!current.alt && smartSnap)({delta,guides}=smartGuides(document,current.keys,delta,screenUnit*6))
    if(!guides.length && wallSnap && !current.alt && current.key.startsWith('m:') && current.keys.length===1){
      const point=snapToWall({x:current.item.x+delta.x,y:current.item.y+delta.y},document.shapes)
      delta={x:point.x-current.item.x,y:point.y-current.item.y}
    }
    return {delta,guides}
  }
  const end = (event) => {
    const current = gestureRef.current
    if (!current) return
    if(current.kind === 'measure') setMeasurement({start:current.start,end:current.end})
    else if(current.kind === 'marquee') {
      if (Math.hypot(current.end.x-current.start.x,current.end.y-current.start.y) < screenUnit*4) {
        if (current.clickKey || !current.additive) onSelect(current.clickKey,{additive:current.additive})
      } else {
        const keys=marqueeSelection(document,current.start,current.end)
        onSelection?.(current.additive?[...new Set([...selection,...keys])]:keys)
      }
    } else if (current.kind === 'draw') {
      const item = shapeFromDrag(current.tool, current.start, current.end, current.id)
      if (item) { onChange({ ...document, shapes: [...document.shapes, item] }); onSelect(`s:${item.id}`) }
    } else if (current.kind === 'drag') {
      onChange(moveSelection(document, current.keys, dragMovement(current).delta))
    } else if (['resize', 'end'].includes(current.kind)) {
      const item = modifiedItem(current)
      if (item.x2 === undefined || item.x !== item.x2 || item.y !== item.y2) {
        const collection = current.key.startsWith('s:') ? 'shapes' : 'markers'
        onChange({ ...document, [collection]: document[collection].map((previous) => previous === current.item ? item : previous) })
      }
    }
    updateGesture(null)
    if (svgRef.current.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId)
  }
  let shapes = document.shapes, markers = document.markers
  if (gesture?.kind === 'drag') {
    const preview = moveSelection(document, gesture.keys, dragMovement(gesture).delta)
    shapes = preview.shapes; markers = preview.markers
  } else if (gesture && ['resize', 'end'].includes(gesture.kind)) {
    const updated = modifiedItem(gesture)
    if (gesture.key.startsWith('s:')) shapes = shapes.map((item) => item === gesture.item ? updated : item)
    else markers = markers.map((item) => item === gesture.item ? updated : item)
  }
  if (gesture?.kind === 'draw') {
    const shape = shapeFromDrag(gesture.tool, gesture.start, gesture.end, gesture.id)
    if (shape) shapes = [...shapes, shape]
  }
  const selectedShape = shapes.find((shape) => `s:${shape.id}` === selected)
  const renderShape = (shape) => {
    const active = selected === `s:${shape.id}` || selection.includes(`s:${shape.id}`)
    const stroke = reference === `s:${shape.id}` ? '#d946ef' : active ? '#1677ff' : '#475569'
    let content
    if (shape.kind === 'room') content = <>
      <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill={shape.color} fillOpacity={0.7} stroke={stroke} strokeWidth={active ? 0.1 : 0.06} />
      {showLabels && <text x={shape.x + shape.width / 2} y={shape.y + Math.min(Math.max(0.65, screenUnit * 16), shape.height / 2)} textAnchor="middle" fontSize={Math.max(0.38, screenUnit * 12)} fill="#334155" pointerEvents="none">{shape.number && document.width / view.width < 1.5 ? `Каб. ${shape.number}` : roomTitle(shape)}</text>}
      {showRoomDimensions && shape.width > 2 && shape.height > 1.5 && <text data-room-dimensions={shape.id} x={shape.x + shape.width / 2} y={shape.y + 1.1} textAnchor="middle" fontSize={Math.max(.27,screenUnit*11)} fill="#64748b" pointerEvents="none">{shape.width} × {shape.height} м · {round(shape.width*shape.height)} м²{shape.locked ? ' · 🔒' : ''}</text>}
    </>
    else if (shape.kind === 'desk') content = <>
      <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={0.1} fill={shape.color} stroke={stroke} strokeWidth={0.06} />
      <rect x={shape.x + shape.width * 0.25} y={shape.y + shape.height * 0.15} width={shape.width * 0.5} height={shape.height * 0.5} rx={0.05} fill="#64748b" />
      {showLabels && shape.label && <text x={shape.x + shape.width / 2} y={shape.y + shape.height + 0.4} textAnchor="middle" fontSize={0.3}>{shape.label}</text>}
    </>
    else if (shape.kind === 'wall') content = <>
      <line x1={shape.x} y1={shape.y} x2={shape.x2} y2={shape.y2} stroke="transparent" strokeWidth={0.55} />
      <line x1={shape.x} y1={shape.y} x2={shape.x2} y2={shape.y2} stroke={stroke} strokeWidth={0.17} strokeLinecap="square" />
    </>
    else if (shape.kind === 'door') {
      const length = Math.hypot(shape.x2 - shape.x, shape.y2 - shape.y)
      const angle = Math.atan2(shape.y2 - shape.y, shape.x2 - shape.x) * 180 / Math.PI
      content = <g transform={`translate(${shape.x} ${shape.y}) rotate(${angle})`}>
        <line x2={length} stroke="white" strokeWidth={0.3} />
        <path d={`M ${length} 0 A ${length} ${length} 0 0 0 0 ${-length}`} fill="none" stroke={active ? '#1677ff' : '#b7791f'} strokeWidth={0.06} />
        <line y2={-length} stroke={active ? '#1677ff' : '#b7791f'} strokeWidth={0.09} />
        <line x2={length} stroke="transparent" strokeWidth={0.6} />
      </g>
    } else content = <text x={shape.x} y={shape.y} fontSize={Math.max(0.45, screenUnit * 12)} fill={active ? '#1677ff' : shape.color}>{shape.label}</text>
    return <g key={shape.id} data-map-key={`s:${shape.id}`} data-locked={Boolean(shape.locked)} className="floor-plan-object"><title>{shape.kind === 'room' ? roomTitle(shape) : shape.label || ({ wall: 'Стена', door: 'Дверь', desk: 'Стол (элемент плана)' }[shape.kind])}{shape.locked ? ' · Заблокирован' : ''}</title>{content}</g>
  }
  const labels = []
  const measure=gesture?.kind==='measure'?gesture:measurement
  const inspected=itemForKey({shapes,markers},selected)
  const distances=measurements&&inspected?wallDistances(inspected,shapes):[]
  return <div className="floor-plan-canvas-wrap">
    <div className="floor-plan-canvas-toolbar">
      <Space size={4}>
        <Tooltip title="Приблизить"><Button aria-label="Приблизить карту" icon={<PlusOutlined />} onClick={() => zoom(1.3)} /></Tooltip>
        <Tooltip title="Отдалить"><Button aria-label="Отдалить карту" icon={<MinusOutlined />} onClick={() => zoom(1 / 1.3)} /></Tooltip>
        <Button icon={<AimOutlined />} onClick={fit}>Весь план</Button>
        <Typography.Text type="secondary">{Math.round(document.width / view.width * 100)}%</Typography.Text>
      </Space>
      <span>{document.width} × {document.height} м · {pendingEntity ? `Нажмите на план: ${pendingEntity.name}` : tool === 'pan' ? 'Перетащите план' : editing ? 'Тяните свободное место — рамка; средняя кнопка — перемещение' : 'Выберите объект на карте'}</span>
    </div>
    <svg ref={svgRef} role="application" aria-label="Интерактивный план этажа" tabIndex={0}
      className={`floor-plan-canvas floor-plan-tool-${pendingEntity ? 'place' : tool}`}
      viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
      onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={() => updateGesture(null)}
      onDoubleClick={(event) => {
        if (editing) return
        const key = event.target.closest('[data-map-key]')?.getAttribute('data-map-key')
        if (key?.startsWith('m:')) onOpen(entities[key.slice(2)])
      }}>
      <defs><pattern id={`map-grid-${floorId}`} width={gridStep || 0.5} height={gridStep || 0.5} patternUnits="userSpaceOnUse">
        <path d={`M ${gridStep || 0.5} 0 L 0 0 0 ${gridStep || 0.5}`} fill="none" stroke="#cbd5e1" strokeWidth={0.025} />
      </pattern></defs>
      <rect x={view.x} y={view.y} width={view.width} height={view.height} fill="#e9eef4" />
      <rect width={document.width} height={document.height} fill="white" />
      {backgroundUrl && !document.remove_background && <image href={backgroundUrl} width={document.width} height={document.height} preserveAspectRatio="none" opacity={document.background_opacity} pointerEvents="none" />}
      {showGrid && <rect width={document.width} height={document.height} fill={`url(#map-grid-${floorId})`} pointerEvents="none" />}
      <rect width={document.width} height={document.height} fill="none" stroke="#94a3b8" strokeWidth={0.06} pointerEvents="none" />
      {shapes.filter((shape) => shape.kind === 'room').map(renderShape)}
      {shapes.filter((shape) => shape.kind !== 'room' && (showLabels || shape.kind !== 'text')).map(renderShape)}
      {markers.filter(marker => visibleTypes.includes(marker.entity_type) || (marker.entity_type === 'workplace' && visibleTypes.includes('employee') && entities[markerKey(marker)]?.employee_name)).map((marker) => {
        const key = markerKey(marker), entity = entities[key]
        const color = markerColor(marker, entity, highlightStatuses)
        const active = selected === `m:${key}` || selection.includes(`m:${key}`)
        const iconScale = Math.max(1, screenUnit * 20)
        const labelY = Math.max(0.95, 0.45 * iconScale + screenUnit * 14)
        const expanded = document.width / view.width >= 1.5 || active
        const label = expanded ? entity?.name || 'Объект удалён' : entity?.inventory_number || entity?.name || 'Удалён'
        const labelWidth = Math.min(label.length, 30) * screenUnit * 7
        const box = { left: marker.x - labelWidth / 2, right: marker.x + labelWidth / 2, top: marker.y + labelY - screenUnit * 12, bottom: marker.y + labelY + screenUnit * (expanded && entity?.employee_name ? 18 : 2) }
        const displayLabel = showLabels && (active || !labels.some(previous => box.left < previous.right && box.right > previous.left && box.top < previous.bottom && box.bottom > previous.top))
        if (displayLabel) labels.push(box)
        return <g key={key} data-map-key={`m:${key}`} className="floor-plan-object" transform={`translate(${marker.x} ${marker.y})`}>
          <title>{[entity?.name, entity?.employee_name, entity?.inventory_number, entity?.status, marker.locked ? 'Заблокирован' : ''].filter(Boolean).join(' · ')}</title>
          <g transform={`rotate(${marker.rotation || 0}) scale(${iconScale})`}>
            {active && <circle r={0.95} fill="#1677ff22" stroke="#1677ff" strokeWidth={0.05} strokeDasharray=".12 .08" />}
            <rect x={-0.6} y={-0.45} width={1.2} height={0.9} rx={0.12} fill="white" stroke={color} strokeWidth={0.09} />
            {marker.entity_type === 'workplace' ? <>
              <rect x={-0.3} y={-0.28} width={0.6} height={0.38} rx={0.03} fill={color} />
              <path d="M 0 .1 V .24 M -.2 .24 H .2" fill="none" stroke={color} strokeWidth={0.07} />
            </> : marker.entity_type === 'device' ? <>
              <path d="M -.3 -.1 V .28 H .3 V -.1 M -.24 -.1 V -.3 H .24 V -.1" fill="none" stroke={color} strokeWidth={0.07} />
              <path d="M -.2 .1 H .2" stroke={color} strokeWidth={0.06} />
            </> : <path d="M -.3 -.2 H .3 V .25 H -.3 Z M -.3 -.05 H .3 M 0 -.2 V .25" fill="none" stroke={color} strokeWidth={0.06} />}
          </g>
          {visibleTypes.includes('employee') && entity?.employee_name && <circle cx={0.5 * iconScale} cy={-0.35 * iconScale} r={0.16 * iconScale} fill={ENTITY_COLORS.employee} stroke="white" strokeWidth={0.04 * iconScale} />}
          {displayLabel && <text y={labelY} textAnchor="middle" fontSize={Math.max(0.32, screenUnit * 11)} fontWeight={600} fill="#1e293b" pointerEvents="none">{label.length > 30 ? `${label.slice(0, 28)}…` : label}</text>}
          {displayLabel && expanded && entity?.employee_name && visibleTypes.includes('employee') && <text y={labelY + Math.max(0.4, screenUnit * 14)} textAnchor="middle" fontSize={Math.max(0.29, screenUnit * 11)} fill="#475569" pointerEvents="none">{entity.employee_name}</text>}
        </g>
      })}
      {networkLayer?.({world,screenUnit,gridStep,interactive:!editing || tool==='select'&&!pendingEntity})}
      {editing && !selectedShape?.locked && ['room', 'desk'].includes(selectedShape?.kind) && ['nw','n','ne','e','se','s','sw','w'].map(handle=>{
        const x=selectedShape.x+selectedShape.width*(handle.includes('w')?0:handle.includes('e')?1:.5)
        const y=selectedShape.y+selectedShape.height*(handle.includes('n')?0:handle.includes('s')?1:.5)
        return <rect key={handle} data-map-key={selected} data-resize={handle} x={x-screenUnit*4} y={y-screenUnit*4} width={screenUnit*8} height={screenUnit*8} fill="#1677ff" stroke="white" strokeWidth={screenUnit} style={{cursor:`${handle}-resize`}} />
      })}
      {editing && !selectedShape?.locked && ['wall', 'door'].includes(selectedShape?.kind) && <circle data-map-key={selected} data-end="true"
        cx={selectedShape.x2} cy={selectedShape.y2} r={0.18} fill="#1677ff" stroke="white" strokeWidth={0.05} style={{ cursor: 'move' }} />}
      {gesture?.kind==='drag'&&dragMovement(gesture).guides.map(guide=><line data-smart-guide={guide.axis} key={guide.axis} x1={guide.axis==='x'?guide.value:0} x2={guide.axis==='x'?guide.value:document.width} y1={guide.axis==='y'?guide.value:0} y2={guide.axis==='y'?guide.value:document.height} stroke="#d946ef" strokeWidth={screenUnit} strokeDasharray={`${screenUnit*6} ${screenUnit*4}`} pointerEvents="none" />)}
      {gesture?.kind==='marquee'&&(()=>{const box=bounds({...gesture.start,x2:gesture.end.x,y2:gesture.end.y});return <rect data-map-marquee="true" x={box.left} y={box.top} width={box.width} height={box.height} fill="#1677ff22" stroke="#1677ff" strokeWidth={screenUnit} pointerEvents="none" />})()}
      {measure&&<g pointerEvents="none"><line x1={measure.start.x} y1={measure.start.y} x2={measure.end.x} y2={measure.end.y} stroke="#ea580c" strokeWidth={screenUnit*2} /><text x={(measure.start.x+measure.end.x)/2} y={(measure.start.y+measure.end.y)/2-screenUnit*8} fontSize={screenUnit*14} fill="#c2410c">{round(Math.hypot(measure.end.x-measure.start.x,measure.end.y-measure.start.y))} м</text></g>}
      {distances.map(gap=><g key={gap.side} pointerEvents="none"><line x1={gap.from.x} y1={gap.from.y} x2={gap.to.x} y2={gap.to.y} stroke="#ea580c" strokeDasharray={`${screenUnit*4} ${screenUnit*3}`} strokeWidth={screenUnit} /><text x={(gap.from.x+gap.to.x)/2} y={(gap.from.y+gap.to.y)/2-screenUnit*4} fontSize={screenUnit*11} fill="#c2410c">{gap.distance} м</text></g>)}
      {measurements&&<g pointerEvents="none">{Array.from({length:Math.floor(document.width/Math.max(1,Math.ceil(screenUnit*70)))+1},(_,i)=>i*Math.max(1,Math.ceil(screenUnit*70))).map(x=><g key={x}><line x1={x} x2={x} y1={0} y2={screenUnit*7} stroke="#64748b" strokeWidth={screenUnit} /><text x={x+screenUnit*2} y={screenUnit*18} fontSize={screenUnit*10} fill="#64748b">{x} м</text></g>)}{Array.from({length:Math.floor(document.height/Math.max(1,Math.ceil(screenUnit*70)))+1},(_,i)=>i*Math.max(1,Math.ceil(screenUnit*70))).map(y=><g key={y}><line x1={0} x2={screenUnit*7} y1={y} y2={y} stroke="#64748b" strokeWidth={screenUnit} /><text x={screenUnit*10} y={y+screenUnit*11} fontSize={screenUnit*10} fill="#64748b">{y} м</text></g>)}</g>}
    </svg>
    <div className="floor-plan-legend"><span><i style={{ background: ENTITY_COLORS.workplace }} />Рабочее место</span>
      <span><i style={{ background: ENTITY_COLORS.device }} />Печатающая техника</span><span><i style={{ background: ENTITY_COLORS.warehouse_item }} />Оборудование</span>
      <span><i style={{ background: ENTITY_COLORS.employee }} />Сотрудник</span>
      {highlightStatuses && <><span><i style={{ background: '#16a34a' }} />Свободное место</span><span><i style={{ background: '#64748b' }} />Место не используется</span><span><i style={{ background: '#dc2626' }} />Техника в ремонте</span><span><i style={{ background: '#94a3b8' }} />Архив / требуется проверка</span></>}
      <span>Размеры в метрах · {editing ? `Привязка: ${gridStep ? `${gridStep} м` : 'выключена'}` : 'Двойной щелчок открывает карточку'}</span></div>
  </div>
}
