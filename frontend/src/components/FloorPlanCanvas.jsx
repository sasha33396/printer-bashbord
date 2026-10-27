import { useEffect, useRef, useState } from 'react'
import { Button, Space, Tooltip, Typography } from 'antd'
import { AimOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons'
import { clamp, ENTITY_COLORS, markerKey, newShapeId, pointOnPlan, round, shapeFromDrag, snap, translateElement } from '../utils/floorPlans'

const itemForKey = (document, key) => key?.startsWith('s:')
  ? document.shapes.find((item) => `s:${item.id}` === key)
  : document.markers.find((item) => `m:${markerKey(item)}` === key)

export default function FloorPlanCanvas({ floorId, document, onChange, editing, saving, tool, onToolChange,
  selected, onSelect, pendingEntity, onPlaced, entities, backgroundUrl, showGrid, gridStep, focus, onOpen }) {
  const svgRef = useRef(null)
  const gestureRef = useRef(null)
  const [gesture, setGesture] = useState(null)
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
    const marker = document.markers.find((item) => markerKey(item) === focus.key)
    if (!marker) return
    const width = Math.min(document.width, 12), height = width * document.height / document.width
    setView({ x: marker.x - width / 2, y: marker.y - height / 2, width, height })
    onSelect(`m:${focus.key}`)
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
    return matrix ? point.matrixTransform(matrix.inverse()) : { x: 0, y: 0 }
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
    } else if (editing && pendingEntity) {
      const point = pointOnPlan(world(event), document, gridStep)
      onPlaced(pendingEntity, point)
      return
    } else if (editing && ['room', 'wall', 'door'].includes(tool)) {
      const point = pointOnPlan(world(event), document, gridStep)
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
      onSelect(key || null)
      if (key && editing) updateGesture({ kind: target.hasAttribute('data-resize') ? 'resize' : target.hasAttribute('data-end') ? 'end' : 'drag',
        key, start: world(event), end: world(event), item: itemForKey(document, key) })
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
    } else updateGesture({ ...current, end: current.kind === 'draw'
      ? pointOnPlan(world(event), document, gridStep) : world(event) })
  }
  const modifiedItem = (current) => {
    const { item, end } = current
    if (current.kind === 'resize') return { ...item,
      width: round(clamp(snap(end.x, gridStep) - item.x, 0.5, document.width - item.x)),
      height: round(clamp(snap(end.y, gridStep) - item.y, 0.5, document.height - item.y)) }
    if (current.kind === 'end') return { ...item, x2: pointOnPlan(end, document, gridStep).x, y2: pointOnPlan(end, document, gridStep).y }
    return translateElement(item, { x: snap(end.x - current.start.x, gridStep), y: snap(end.y - current.start.y, gridStep) }, document)
  }
  const end = (event) => {
    const current = gestureRef.current
    if (!current) return
    if (current.kind === 'draw') {
      const item = shapeFromDrag(current.tool, current.start, current.end, current.id)
      if (item) { onChange({ ...document, shapes: [...document.shapes, item] }); onSelect(`s:${item.id}`) }
    } else if (['drag', 'resize', 'end'].includes(current.kind)) {
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
  if (gesture && ['drag', 'resize', 'end'].includes(gesture.kind)) {
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
    const active = selected === `s:${shape.id}`
    const stroke = active ? '#1677ff' : '#475569'
    let content
    if (shape.kind === 'room') content = <>
      <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill={shape.color} fillOpacity={0.7} stroke={stroke} strokeWidth={active ? 0.1 : 0.06} />
      <text x={shape.x + shape.width / 2} y={shape.y + Math.min(Math.max(0.65, screenUnit * 16), shape.height / 2)} textAnchor="middle" fontSize={Math.max(0.38, screenUnit * 12)} fill="#334155" pointerEvents="none">{shape.label}</text>
      {shape.width > 2 && shape.height > 1.5 && <text x={shape.x + shape.width / 2} y={shape.y + 1.1} textAnchor="middle" fontSize={0.27} fill="#64748b" pointerEvents="none">{shape.width} × {shape.height} м</text>}
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
    return <g key={shape.id} data-map-key={`s:${shape.id}`} className="floor-plan-object"><title>{shape.label || ({ wall: 'Стена', door: 'Дверь' }[shape.kind])}</title>{content}</g>
  }
  return <div className="floor-plan-canvas-wrap">
    <div className="floor-plan-canvas-toolbar">
      <Space size={4}>
        <Tooltip title="Приблизить"><Button aria-label="Приблизить карту" icon={<PlusOutlined />} onClick={() => zoom(1.3)} /></Tooltip>
        <Tooltip title="Отдалить"><Button aria-label="Отдалить карту" icon={<MinusOutlined />} onClick={() => zoom(1 / 1.3)} /></Tooltip>
        <Button icon={<AimOutlined />} onClick={fit}>Весь план</Button>
        <Typography.Text type="secondary">{Math.round(document.width / view.width * 100)}%</Typography.Text>
      </Space>
      <span>{document.width} × {document.height} м · {pendingEntity ? `Нажмите на план: ${pendingEntity.name}` : tool === 'pan' ? 'Перетащите план' : editing ? 'Колесо — масштаб, средняя кнопка — перемещение' : 'Выберите объект на карте'}</span>
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
      {shapes.filter((shape) => shape.kind !== 'room').map(renderShape)}
      {markers.map((marker) => {
        const key = markerKey(marker), entity = entities[key]
        const color = entity?.available === false || entity?.placement_warning ? '#94a3b8' : ENTITY_COLORS[marker.entity_type]
        const active = selected === `m:${key}`
        const iconScale = Math.max(1, screenUnit * 20)
        const labelY = Math.max(0.95, 0.45 * iconScale + screenUnit * 14)
        return <g key={key} data-map-key={`m:${key}`} className="floor-plan-object" transform={`translate(${marker.x} ${marker.y})`}>
          <title>{[entity?.name, entity?.employee_name, entity?.inventory_number].filter(Boolean).join(' · ')}</title>
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
          <text y={labelY} textAnchor="middle" fontSize={Math.max(0.32, screenUnit * 11)} fontWeight={600} fill="#1e293b" pointerEvents="none">{entity?.name || 'Объект удалён'}</text>
          {entity?.employee_name && <text y={labelY + Math.max(0.4, screenUnit * 14)} textAnchor="middle" fontSize={Math.max(0.29, screenUnit * 11)} fill="#475569" pointerEvents="none">{entity.employee_name}</text>}
        </g>
      })}
      {editing && selectedShape?.kind === 'room' && <rect data-map-key={selected} data-resize="true" x={selectedShape.x + selectedShape.width - 0.16}
        y={selectedShape.y + selectedShape.height - 0.16} width={0.32} height={0.32} fill="#1677ff" stroke="white" strokeWidth={0.05} style={{ cursor: 'nwse-resize' }} />}
      {editing && ['wall', 'door'].includes(selectedShape?.kind) && <circle data-map-key={selected} data-end="true"
        cx={selectedShape.x2} cy={selectedShape.y2} r={0.18} fill="#1677ff" stroke="white" strokeWidth={0.05} style={{ cursor: 'move' }} />}
    </svg>
    <div className="floor-plan-legend"><span><i style={{ background: ENTITY_COLORS.workplace }} />Рабочее место</span>
      <span><i style={{ background: ENTITY_COLORS.device }} />Печатающая техника</span><span><i style={{ background: ENTITY_COLORS.warehouse_item }} />Оборудование</span>
      <span>Размеры в метрах · {editing ? `Привязка: ${gridStep ? `${gridStep} м` : 'выключена'}` : 'Двойной щелчок открывает карточку'}</span></div>
  </div>
}
