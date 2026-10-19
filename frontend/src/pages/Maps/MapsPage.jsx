import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, Button, Checkbox, Descriptions, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select, Slider, Space, Spin, Switch, Tag, Tooltip, Typography, Upload, message } from 'antd'
import { ApartmentOutlined, CopyOutlined, DeleteOutlined, EditOutlined, ExpandOutlined, CompressOutlined, FileImageOutlined, HistoryOutlined, MenuFoldOutlined, MenuUnfoldOutlined, PlusOutlined, RedoOutlined, SaveOutlined, SettingOutlined, UndoOutlined } from '@ant-design/icons'
import api from '../../api/api'
import FloorPlanCanvas from '../../components/FloorPlanCanvas'
import MapVersionsModal from '../../components/MapVersionsModal'
import MapEditingTools from '../../components/MapEditingTools'
import { useMapNetwork } from '../../components/MapNetwork'
import { bindRooms, containsPoint, copySelection, documentFromFloor, draftPositions, elementKey, ENTITY_COLORS, ENTITY_TYPES, expandedSelection, filterMapCatalog, groupSelection, historyReducer, mapSummary, MAP_TOOLS, markerKey, moveSelection, newShapeId, pasteShapes, roomAt, roomContents, roomTitle } from '../../utils/floorPlans'
import { deleteMapDraft, readMapDraft, writeMapDraft } from '../../utils/mapDrafts'
import './maps.css'

const EMPTY_DOCUMENT = { name: '', width: 40, height: 25, background_opacity: 0.4, remove_background: false, shapes: [], markers: [], network: { nodes: [], links: [] }, network_revision: 0 }
const errorText = (error) => {
  const detail = error.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map((row) => row.msg).join('; ')
  return error.response?.status === 413 ? 'Файл подложки слишком большой. Допускается до 10 МБ.' : 'Не удалось выполнить операцию. Проверьте соединение.'
}
const fits = (document) => document.shapes.every((shape) => shape.x <= document.width && shape.y <= document.height
  && (shape.x2 ?? 0) <= document.width && (shape.y2 ?? 0) <= document.height
  && (!['room', 'desk'].includes(shape.kind) || (shape.x + shape.width <= document.width && shape.y + shape.height <= document.height)))
  && document.markers.every((marker) => marker.x <= document.width && marker.y <= document.height)
  && [...(document.network?.nodes || []),...(document.network?.links || []).flatMap(link=>[...(link.route||[]),...(link.remote_point?[link.remote_point]:[])])].every(point=>point.x<=document.width&&point.y<=document.height)

function SettingsModal({ mode, building, document, branches, onClose, onSaved, onParameters }) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!mode) return
    form.resetFields()
    form.setFieldsValue(mode === 'parameters' ? document : mode === 'editBuilding' ? building : { width: 40, height: 25 })
  }, [mode, form])
  const save = async () => {
    let values
    try { values = await form.validateFields() } catch { return }
    if (mode === 'parameters') {
      if (!fits({ ...document, ...values })) return message.error('Новый размер обрезает элементы плана. Сначала переместите или удалите их.')
      onParameters(values); return
    }
    setSaving(true)
    try {
      const response = mode === 'floor'
        ? await api.post(`/maps/buildings/${building.id}/floors`, values)
        : mode === 'editBuilding'
          ? await api.put(`/maps/buildings/${building.id}`, { ...values, branch_id: values.branch_id ?? null })
          : await api.post('/maps/buildings', { ...values, branch_id: values.branch_id ?? null })
      await onSaved(response.data, mode)
    } catch (error) { message.error(errorText(error)) } finally { setSaving(false) }
  }
  const forFloor = ['floor', 'parameters'].includes(mode)
  return <Modal open={Boolean(mode)} title={mode === 'parameters' ? 'Параметры плана' : mode === 'floor' ? 'Новый этаж / план помещения' : mode === 'editBuilding' ? 'Редактировать здание' : 'Новое здание'}
    onCancel={() => { if (!saving) onClose() }} onOk={save} confirmLoading={saving} cancelButtonProps={{ disabled: saving }} maskClosable={!saving}
    okText={mode === 'parameters' ? 'Применить к рисунку' : 'Сохранить'} cancelText="Отмена" destroyOnClose>
    <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
      <Form.Item name="name" label={forFloor ? 'Название этажа / плана' : 'Название здания'} rules={[{ required: true, whitespace: true }]}><Input maxLength={255} placeholder={forFloor ? '1 этаж' : 'Административный корпус'} /></Form.Item>
      {forFloor ? <>
        <Form.Item name="width" label="Ширина плана, м" rules={[{ required: true }]}><InputNumber min={2} max={500} step={0.5} style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="height" label="Длина плана, м" rules={[{ required: true }]}><InputNumber min={2} max={500} step={0.5} style={{ width: '100%' }} /></Form.Item>
        <Typography.Text type="secondary">Размеры задают масштаб рисунка и подложки. Например, для здания 40 × 25 м укажите 40 и 25.</Typography.Text>
      </> : <>
        <Form.Item name="branch_id" label="Филиал"><Select allowClear showSearch optionFilterProp="label" placeholder="Не привязывать к филиалу" options={branches.map((row) => ({ value: row.id, label: row.name }))} /></Form.Item>
        <Form.Item name="address" label="Адрес"><Input maxLength={500} /></Form.Item>
      </>}
    </Form>
  </Modal>
}

function Inspector({ selected, document, entities, departments, editable, onChange, onDelete, onOpen }) {
  const marker = selected?.startsWith('m:') ? document.markers.find((row) => `m:${markerKey(row)}` === selected) : null
  const shape = selected?.startsWith('s:') ? document.shapes.find((row) => `s:${row.id}` === selected) : null
  const element = marker || shape
  if (!element) return <div className="map-inspector-empty"><ApartmentOutlined /><p>Выберите комнату, стену или объект на плане</p></div>
  const entity = marker ? entities[markerKey(marker)] : null
  const update = (changes) => {
    const collection = marker ? 'markers' : 'shapes'
    const next = { ...element, ...changes }
    if (next.x2 !== undefined && next.x === next.x2 && next.y === next.y2) return
    const draft = { ...document, [collection]: document[collection].map((row) => row === element ? next : row) }
    if (fits(draft)) onChange(draft)
  }
  const coordinate = (axis, value) => {
    if (value == null || !Number.isFinite(value)) return
    onChange(moveSelection(document, [selected], { x: axis === 'x' ? value - element.x : 0, y: axis === 'y' ? value - element.y : 0 }))
  }
  const members = shape?.kind === 'room' ? roomContents(document, shape, entities) : null
  return <div className="map-inspector">
    <Typography.Title level={5}>{entity?.name || (shape?.kind === 'room' ? roomTitle(shape) : ({ wall: 'Стена', door: 'Дверь', desk: 'Стол', text: 'Подпись' }[shape?.kind])) || 'Объект удалён'}</Typography.Title>
    {entity && <>
      <Tag color={ENTITY_COLORS[marker.entity_type]}>{entity.category}</Tag>
      <Tag>{({ occupied: 'Занято', vacant: 'Свободно', inactive: 'Не используется', active: 'Рабочий', repair: 'В ремонте', decommissioned: 'Списан' })[entity.status] || entity.status || 'Состояние не указано'}</Tag>
      {entity.available === false && <Alert type="warning" showIcon message="Объект удалён или архивирован. Отметку можно снять с карты." />}
      {entity.placement_warning && <Alert type="warning" showIcon message={entity.placement_warning} />}
      <dl className="map-object-details">
        {Object.entries({ 'Сотрудник': entity.employee_name, 'Инв. №': entity.inventory_number, 'Филиал': entity.branch_name, 'Отдел': entity.department_name }).filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      {entity.path && <Button block onClick={() => onOpen(entity)}>Открыть карточку</Button>}
      {!!entity.equipment?.length && <div className="map-linked-assets"><strong>Оборудование рабочего места</strong>
        {entity.equipment.map((asset) => <Button type="link" key={asset.id} onClick={() => onOpen(asset)}>{[asset.inventory_number, asset.name].filter(Boolean).join(' · ')}</Button>)}
      </div>}
    </>}
    {members && <div className="map-room-contents">
      <p>{departments.find(department => department.id === shape.department_id)?.name || 'Отдел не указан'}{shape.notes ? ` · ${shape.notes}` : ''}</p>
      <strong>Состав кабинета</strong>
      <p>Рабочих мест: {members.workplaces.length} · принтеров: {members.devices.length} · оборудования: {members.equipment.length}</p>
      {!members.workplaces.length && !members.devices.length && !members.equipment.length && <Typography.Text type="secondary">В кабинете ещё нет объектов. Разместите отметки внутри его границ или выберите кабинет в свойствах отметки.</Typography.Text>}
      {members.workplaces.map(place => <Button key={`w:${place.entity_id}`} type="link" onClick={() => onOpen(place)}>{place.name} · {place.employee_name || 'Сотрудник не назначен'}</Button>)}
      {members.devices.map(device => <Button key={`d:${device.entity_id}`} type="link" onClick={() => onOpen(device)}>{device.inventory_number || 'Без №'} · {device.name}</Button>)}
      {members.equipment.map(asset => <Button key={`a:${asset.entity_id || asset.id}`} type="link" onClick={() => onOpen(asset)}>{asset.inventory_number || 'Без №'} · {asset.name}</Button>)}
    </div>}
    {!editable && shape && <Typography.Text type="secondary">{shape.width ? `${shape.width} × ${shape.height} м` : `X: ${shape.x} · Y: ${shape.y}`}{shape.locked ? ' · Перемещение заблокировано' : ''}</Typography.Text>}
    {editable && <><div className="map-lock-field"><Switch aria-label="Заблокировать элемент" checked={Boolean(element.locked)} onChange={locked => update({ locked })} /> Заблокировать перемещение</div>
    <Form layout="vertical" disabled={!editable || element.locked}>
      {shape?.kind === 'room' && <>
        <Form.Item label="Номер кабинета"><Input aria-label="Номер кабинета" maxLength={50} value={shape.number || ''} onChange={event => update({ number: event.target.value })} /></Form.Item>
        <Form.Item label="Отдел кабинета"><Select aria-label="Отдел кабинета" allowClear showSearch optionFilterProp="label" value={shape.department_id || undefined}
          options={departments.map(department => ({ value: department.id, label: department.name }))} onChange={department_id => update({ department_id: department_id || null })} /></Form.Item>
        <Form.Item label="Примечание кабинета"><Input.TextArea aria-label="Примечание кабинета" rows={2} maxLength={2000} value={shape.notes || ''} onChange={event => update({ notes: event.target.value })} /></Form.Item>
      </>}
      {shape && !['wall', 'door'].includes(shape.kind) && <Form.Item label={shape.kind === 'room' ? 'Название кабинета' : 'Подпись'}><Input aria-label="Подпись элемента" maxLength={200} value={shape.label} onChange={(event) => update({ label: event.target.value })} /></Form.Item>}
      {marker && <Form.Item label="Кабинет"><Select aria-label="Кабинет отметки" allowClear value={marker.room_id || undefined}
        options={document.shapes.filter(room => room.kind === 'room').map(room => ({ value: room.id, label: roomTitle(room) }))}
        onChange={room_id => {
          const room = document.shapes.find(shape => shape.id === room_id)
          update({ room_id: room_id || null, ...(room && !containsPoint(room, marker) ? { x: room.x + room.width / 2, y: room.y + room.height / 2 } : {}) })
        }} /></Form.Item>}
      <div className="map-coordinate-fields">
        <Form.Item label="X, м"><InputNumber aria-label="Координата X" value={element.x} min={0} max={document.width} step={0.5} onChange={(value) => coordinate('x', value)} /></Form.Item>
        <Form.Item label="Y, м"><InputNumber aria-label="Координата Y" value={element.y} min={0} max={document.height} step={0.5} onChange={(value) => coordinate('y', value)} /></Form.Item>
      </div>
      {['room', 'desk'].includes(shape?.kind) && <div className="map-coordinate-fields">
        <Form.Item label="Ширина, м"><InputNumber aria-label="Ширина комнаты" value={shape.width} min={0.5} max={document.width - shape.x} step={0.5} onChange={(value) => { if (value >= 0.5) update({ width: value }) }} /></Form.Item>
        <Form.Item label="Длина, м"><InputNumber aria-label="Длина комнаты" value={shape.height} min={0.5} max={document.height - shape.y} step={0.5} onChange={(value) => { if (value >= 0.5) update({ height: value }) }} /></Form.Item>
      </div>}
      {shape && ['wall', 'door'].includes(shape.kind) && <div className="map-coordinate-fields">
        <Form.Item label="Конец X, м"><InputNumber aria-label="Конец X" value={shape.x2} min={0} max={document.width} step={0.5} onChange={(value) => { if (value != null) update({ x2: value }) }} /></Form.Item>
        <Form.Item label="Конец Y, м"><InputNumber aria-label="Конец Y" value={shape.y2} min={0} max={document.height} step={0.5} onChange={(value) => { if (value != null) update({ y2: value }) }} /></Form.Item>
      </div>}
      {shape && ['room', 'desk', 'text'].includes(shape.kind) && <Form.Item label="Цвет"><input aria-label="Цвет элемента" type="color" value={shape.color} disabled={!editable || element.locked} onChange={(event) => update({ color: event.target.value })} /></Form.Item>}
      {marker && <Form.Item label="Поворот, °"><InputNumber aria-label="Поворот объекта" value={marker.rotation || 0} min={0} max={359} step={15} onChange={(value) => { if (value != null) update({ rotation: value }) }} /></Form.Item>}
    </Form></>}
    {editable && <Button danger block disabled={element.locked} icon={<DeleteOutlined />} onClick={onDelete}>{marker ? 'Снять отметку с карты' : 'Удалить элемент плана'}</Button>}
    {marker && <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>Снятие отметки сохраняет карточку и историю оборудования. Перемещения между филиалами оформляются в карточках.</Typography.Paragraph>}
  </div>
}

export default function MapsPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const initialParams = useRef(params)
  const [buildings, setBuildings] = useState([])
  const [branches, setBranches] = useState([])
  const [departments, setDepartments] = useState([])
  const [catalog, setCatalog] = useState([])
  const [networkGraph,setNetworkGraph] = useState({revision:0,nodes:[],links:[]})
  const networkRef=useRef(null)
  const [smartSnap,setSmartSnap]=useState(true),[measurements,setMeasurements]=useState(false),[reference,setReference]=useState(null)
  const [buildingId, setBuildingId] = useState()
  const [floor, setFloor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [mode, setMode] = useState(null)
  const [selected, setPrimarySelected] = useState(null)
  const [selection, setSelection] = useState([])
  const clipboard = useRef([])
  const [visibleTypes, setVisibleTypes] = useState(['workplace', 'employee', 'device', 'warehouse_item'])
  const [showLabels, setShowLabels] = useState(true)
  const [showRoomDimensions,setShowRoomDimensions] = useState(false)
  const [highlightStatuses, setHighlightStatuses] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [wallSnap, setWallSnap] = useState(true)
  const [placementFilter, setPlacementFilter] = useState()
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [employeeInfo, setEmployeeInfo] = useState(null)
  const [recoverableDraft, setRecoverableDraft] = useState(null)
  const [draftStatus, setDraftStatus] = useState('')
  const [draftBaseRevision, setDraftBaseRevision] = useState(null)
  const draftState = useRef(null)
  const draftQueue = useRef(Promise.resolve())
  const draftSuppression = useRef(new Map())
  const [pendingEntity, setPendingEntity] = useState(null)
  const [tool, setTool] = useState('select')
  const [search, setSearch] = useState('')
  const [entityType, setEntityType] = useState()
  const [showGrid, setShowGrid] = useState(true)
  const [gridStep, setGridStep] = useState(0.5)
  const [focus, setFocus] = useState(null)
  const [savedJSON, setSavedJSON] = useState(JSON.stringify(EMPTY_DOCUMENT))
  const [conflict, setConflict] = useState('')
  const [backgroundFile, setBackgroundFile] = useState(null)
  const [serverBackground, setServerBackground] = useState(null)
  const [previewBackground, setPreviewBackground] = useState(null)
  const [backgroundSize, setBackgroundSize] = useState(null)
  const [state, dispatch] = useReducer(historyReducer, { past: [], present: EMPTY_DOCUMENT, future: [] })
  const document = state.present
  useEffect(() => {
    if (!fullscreen) return
    const previous = window.document.body.style.overflow
    window.document.body.style.overflow = 'hidden'
    const escape = event => { if (event.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', escape)
    return () => { window.document.body.style.overflow = previous; window.removeEventListener('keydown', escape) }
  }, [fullscreen])
  const dirty = Boolean(floor && (JSON.stringify(document) !== savedJSON || backgroundFile))
  const documentRef = useRef(document)
  const dirtyRef = useRef(dirty)
  documentRef.current = document
  dirtyRef.current = dirty
  const requestId = useRef(0)
  const backgroundRequestId = useRef(0)
  const building = buildings.find((row) => row.id === buildingId)
  const commit = useCallback((next) => dispatch({ type: 'commit', document: bindRooms(next) }), [])
  const setSelected = (key, { additive = false, keep = false } = {}) => {
    networkRef.current?.clearSelection()
    setPrimarySelected(key)
    setSelection(previous => !key ? [] : additive ? previous.includes(key) ? previous.filter(item => item !== key) : [...previous, key] : keep ? previous : [key])
    if (key) setInspectorOpen(true)
  }
  draftState.current = { floorId: floor?.id, document, backgroundFile, dirty, base_revision: draftBaseRevision ?? floor?.revision }
  const persistDraft = useCallback(() => {
    const value = draftState.current
    if (!value?.floorId || !value.dirty) return Promise.resolve()
    const suppressed = draftSuppression.current.get(value.floorId)
    if (suppressed?.document === value.document && suppressed?.backgroundFile === value.backgroundFile) return Promise.resolve()
    setDraftStatus('Сохранение черновика…')
    draftQueue.current = draftQueue.current.catch(() => {}).then(() => writeMapDraft(value.floorId, {
      document: value.document, backgroundFile: value.backgroundFile, base_revision: value.base_revision,
    }))
    return draftQueue.current.then(() => {
      if (draftState.current?.floorId === value.floorId && draftState.current.dirty && draftState.current.document === value.document && draftState.current.backgroundFile === value.backgroundFile) setDraftStatus('Черновик сохранён на этом устройстве')
    }).catch(() => { setDraftStatus('Не удалось сохранить черновик. Сохраните план на сервер.'); })
  }, [])
  const clearDraft = useCallback(async (floorId) => {
    if (draftState.current?.floorId === floorId) draftSuppression.current.set(floorId, { document: draftState.current.document, backgroundFile: draftState.current.backgroundFile })
    if (draftState.current?.floorId === floorId) draftState.current = { ...draftState.current, dirty: false }
    await draftQueue.current.catch(() => {})
    try { await deleteMapDraft(floorId) } catch { message.warning('Не удалось удалить локальный черновик') }
    setRecoverableDraft(null); setDraftStatus('')
  }, [])
  useEffect(() => {
    if (!dirty || !floor?.id) return
    setDraftStatus('Сохранение черновика…')
    const timer = setTimeout(persistDraft, 400)
    return () => clearTimeout(timer)
  }, [dirty, document, backgroundFile, floor?.id, draftBaseRevision, persistDraft])
  useEffect(() => {
    const flush = () => { persistDraft() }
    window.addEventListener('pagehide', flush)
    return () => { window.removeEventListener('pagehide', flush); persistDraft() }
  }, [persistDraft])
  useEffect(() => () => { if (serverBackground) URL.revokeObjectURL(serverBackground) }, [serverBackground])
  useEffect(() => () => { if (previewBackground) URL.revokeObjectURL(previewBackground) }, [previewBackground])
  useEffect(() => {
    const url = previewBackground || serverBackground
    if (!url) return
    let active = true
    const image = new Image()
    image.onload = () => { if (active) setBackgroundSize({ width: image.naturalWidth, height: image.naturalHeight }) }
    image.src = url
    return () => { active = false }
  }, [serverBackground, previewBackground])

  const confirmDiscard = useCallback((callback) => {
    if (!dirtyRef.current) return callback()
    Modal.confirm({ title: 'Отбросить несохранённые изменения плана?', content: 'Рисунок и отметки ещё не сохранены.',
      okText: 'Отбросить', cancelText: 'Остаться', okButtonProps: { danger: true }, onOk: async () => {
        await clearDraft(draftState.current?.floorId); dirtyRef.current = false; return callback()
      } })
  }, [clearDraft])
  const refreshIndex = async () => {
    const [indexResponse, catalogResponse, networkResponse] = await Promise.all([api.get('/maps/buildings'), api.get('/maps/catalog'), api.get('/maps/network')])
    setBuildings(indexResponse.data); setCatalog(catalogResponse.data)
    setNetworkGraph(networkResponse.data)
    return indexResponse.data
  }
  const loadFloor = useCallback(async (id, { focusKey, placeKey } = {}) => {
    const request = ++requestId.current
    backgroundRequestId.current += 1
    setLoading(true); setLoadError('')
    try {
      const [response, catalogResponse, networkResponse] = await Promise.all([api.get(`/maps/floors/${id}`), api.get('/maps/catalog'), api.get('/maps/network')])
      if (request !== requestId.current) return
      const next = response.data, nextDocument = documentFromFloor(next)
      setFloor(next); setBuildingId(next.building_id); setCatalog(catalogResponse.data)
      setNetworkGraph(networkResponse.data);setReference(null)
      dispatch({ type: 'reset', document: nextDocument }); setSavedJSON(JSON.stringify(nextDocument))
      setSelected(null); setPendingEntity(null); setTool('select'); setEditing(false); setConflict('')
      setBackgroundFile(null); setPreviewBackground(null); setServerBackground(null); setBackgroundSize(null)
      setDraftBaseRevision(next.revision); setDraftStatus(''); setRecoverableDraft(null)
      localStorage.setItem('map_floor_id', String(id))
      setFocus(focusKey ? { key: focusKey, at: Date.now() } : null)
      if (placeKey) {
        let entity = catalogResponse.data.find((row) => markerKey(row) === placeKey)
        if (entity?.entity_type === 'employee') entity = entity.placement_target ? catalogResponse.data.find(row => markerKey(row) === markerKey(entity.placement_target)) : null
        if (entity?.entity_type === 'room') entity = null
        if (entity) { setEditing(true); setPendingEntity(entity) }
      }
      try {
        const draft = await readMapDraft(id)
        if (request !== requestId.current) return
        if (draft?.document) setRecoverableDraft(draft)
      } catch { if (request === requestId.current) setDraftStatus('Локальные черновики недоступны в этом браузере') }
      if (next.has_background) {
        try {
          const background = await api.get(`/maps/floors/${id}/background`, { responseType: 'blob' })
          if (request === requestId.current) setServerBackground(URL.createObjectURL(background.data))
        } catch { if (request === requestId.current) message.warning('План открыт, но подложку загрузить не удалось') }
      }
    } catch (error) { if (request === requestId.current) setLoadError(errorText(error)) }
    finally { if (request === requestId.current) setLoading(false) }
  }, [])
  useEffect(() => {
    let cancelled = false
    const initialize = async () => {
      try {
        const [indexResponse, branchResponse, catalogResponse, departmentResponse] = await Promise.all([
          api.get('/maps/buildings'), api.get('/orgs/branches'), api.get('/maps/catalog'), api.get('/orgs/departments'),
        ])
        if (cancelled) return
        setBuildings(indexResponse.data); setBranches(branchResponse.data); setCatalog(catalogResponse.data); setDepartments(departmentResponse.data)
        const floors = indexResponse.data.flatMap((row) => row.floors.map((item) => ({ ...item, building: row })))
        const route = initialParams.current
        const placeKey = route.get('place')
        const entity = catalogResponse.data.find((row) => markerKey(row) === placeKey)
        const preferred = Number(route.get('floor') || localStorage.getItem('map_floor_id'))
        const target = floors.find((row) => row.id === preferred) || (entity?.branch_id && floors.find((row) => row.building.branch_id === entity.branch_id)) || floors[0]
        if (target) await loadFloor(target.id, { focusKey: route.get('focus'), placeKey })
        else { setBuildingId(indexResponse.data[0]?.id); setLoading(false) }
      } catch (error) { if (!cancelled) { setLoadError(errorText(error)); setLoading(false) } }
    }
    initialize()
    return () => { cancelled = true; requestId.current += 1 }
  }, [loadFloor])
  useEffect(() => {
    const beforeUnload = (event) => { if (dirtyRef.current) { persistDraft(); event.preventDefault(); event.returnValue = '' } }
    const linkClick = (event) => {
      if (!dirtyRef.current || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      const link = event.target.closest('a[href]')
      if (!link || link.target === '_blank') return
      const url = new URL(link.href, window.location.origin)
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname && url.search === window.location.search) return
      event.preventDefault(); event.stopPropagation()
      confirmDiscard(() => navigate(url.pathname + url.search))
    }
    window.addEventListener('beforeunload', beforeUnload)
    window.document.addEventListener('click', linkClick, true)
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.document.removeEventListener('click', linkClick, true) }
  }, [confirmDiscard, navigate, persistDraft])

  const removeSelected = useCallback(() => {
    if (!editing || saving || !selected) return
    const current = documentRef.current
    // Group deletion includes the group, but deleting a room alone keeps its marks.
    const keys = new Set(selection.length ? selection : [selected])
    const elements = [...current.shapes, ...current.markers]
    const groups = new Set(elements.filter(item => keys.has(elementKey(item)) && item.group_id).map(item => item.group_id))
    for (const item of elements) if (item.group_id && groups.has(item.group_id)) keys.add(elementKey(item))
    commit({ ...current, shapes: current.shapes.filter(row => row.locked || !keys.has(elementKey(row))),
      markers: current.markers.filter(row => row.locked || !keys.has(elementKey(row))) })
    setSelected(null)
  }, [selected, selection, editing, saving, commit])
  const paste = () => {
    const result = pasteShapes(documentRef.current, clipboard.current)
    if (!result.keys.length) return message.info('Скопируйте кабинет, стол или другой элемент плана. Учётные объекты не дублируются.')
    if (!fits(result.document)) return message.warning('Скопированные элементы не помещаются на этом плане')
    commit(result.document); setSelection(result.keys); setPrimarySelected(result.keys.at(-1))
  }
  useEffect(() => {
    const keydown = (event) => {
      if (!editing || saving || event.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
      if ((event.ctrlKey || event.metaKey) && ['z', 'я'].includes(event.key.toLowerCase())) {
        event.preventDefault(); dispatch({ type: event.shiftKey ? 'redo' : 'undo' })
      } else if ((event.ctrlKey || event.metaKey) && ['c', 'с'].includes(event.key.toLowerCase())) {
        event.preventDefault(); clipboard.current = copySelection(documentRef.current, selection)
      } else if ((event.ctrlKey || event.metaKey) && ['v', 'м'].includes(event.key.toLowerCase())) {
        event.preventDefault(); paste()
      } else if ((event.ctrlKey || event.metaKey) && ['d', 'в'].includes(event.key.toLowerCase())) {
        event.preventDefault(); clipboard.current = copySelection(documentRef.current, selection); paste()
      } else if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key) && (selection.length || networkRef.current?.selected)) {
        event.preventDefault();const step=event.shiftKey?1:.1
        const delta={x:event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,y:event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0}
        if(selection.length)commit(moveSelection(documentRef.current,selection,delta))
        else networkRef.current?.nudge(delta)
      } else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected() }
      else if (event.key === 'Escape') { setPendingEntity(null); setTool('select'); setSelected(null) }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [editing, saving, removeSelected, selection])

  const entities = useMemo(() => Object.fromEntries([
    ...(floor?.markers || []).map(marker => [markerKey(marker), { ...marker.entity, entity_type: marker.entity_type, entity_id: marker.entity_id }]),
    ...catalog.map(entity => [markerKey(entity), { ...entity,
      placement_warning: entity.placement_warning || (entity.position && entity.position.branch_id && entity.branch_id && entity.position.branch_id !== entity.branch_id ? 'Филиал объекта изменился. Перенесите или снимите отметку.' : null),
    }]),
  ]), [catalog, floor])
  const liveCatalog = useMemo(() => {
    const rows = draftPositions(entities, document, floor, building).filter(entity => entity.entity_type !== 'room' || entity.position?.floor_id !== floor?.id)
    if (floor) for (const room of document.shapes.filter(shape => shape.kind === 'room')) {
      const members = roomContents(document, room, entities)
      rows.push({ entity_type: 'room', entity_id: `${floor.id}:${room.id}`, shape_id: room.id, name: roomTitle(room), category: 'Кабинет',
        inventory_number: room.number, available: true, branch_id: building?.branch_id,
        department_name: departments.find(department => department.id === room.department_id)?.name,
        employee_name: members.workplaces.map(place => place.employee_name).filter(Boolean).join(', '),
        equipment: [...members.devices, ...members.equipment],
        position: { floor_id: floor.id, floor_name: document.name, building_name: building?.name, entity_type: 'room', entity_id: room.id, inherited: false } })
    }
    return rows
  }, [entities, document, floor, building, departments])
  const network = useMapNetwork({document,floor,graph:networkGraph,catalog:liveCatalog,editing,saving:saving||loading,onChange:commit,
    onDeselect:()=>{setPrimarySelected(null);setSelection([]);setPendingEntity(null);setTool('select')},onOpenInspector:()=>setInspectorOpen(true),focus,
    onNavigate:(id,key)=>id===floor?.id?setFocus({key,at:Date.now()}):changeFloor(id,{focusKey:key})})
  networkRef.current=network
  const searchCatalog = useMemo(()=>[...liveCatalog,...network.nodes.map(node=>({entity_type:'network',entity_id:node.id,name:node.name,category:'Сетевой узел',inventory_number:[node.ip_address,node.hostname,node.group].filter(Boolean).join(' · '),available:!node.unavailable,
    position:{floor_id:node.floor_id,floor_name:node.floor_name,building_name:node.building_name,entity_type:'network',entity_id:node.id}}))],[liveCatalog,network.nodes])
  const matches = useMemo(() => filterMapCatalog(searchCatalog, { search, type: entityType }).filter(entity => {
    if (placementFilter === 'unplaced') return !entity.position && entity.available !== false
    if (placementFilter === 'archived') return entity.available === false
    if (placementFilter === 'mismatch') return Boolean(entity.placement_warning)
    if (placementFilter === 'floor') return Boolean(floor && entity.position?.floor_id === floor.id)
    return true
  }).sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true, sensitivity: 'base' })), [searchCatalog, search, entityType, placementFilter, floor?.id])
  const summary = useMemo(() => mapSummary(document, entities), [document, entities])
  const changeTool = (next) => { setTool(next); setPendingEntity(null) }
  const changeFloor = (id, options) => confirmDiscard(() => { setParams({ floor: String(id), ...(options?.focusKey ? { focus: options.focusKey } : {}) }); loadFloor(id, options) })
  const pickEntity = (entity) => {
    if(entity.entity_type==='network'){
      const key=`network:${entity.entity_id}`
      if(entity.position.floor_id===floor?.id)return setFocus({key,at:Date.now()})
      return changeFloor(entity.position.floor_id,{focusKey:key})
    }
    if (entity.entity_type === 'room') {
      if (entity.position.floor_id === floor?.id) return setFocus({ key: `room:${entity.position.entity_id}`, at: Date.now() })
      return changeFloor(entity.position.floor_id, { focusKey: `room:${entity.position.entity_id}` })
    }
    if (entity.entity_type === 'employee') {
      if (entity.position) {
        const focusKey = `${entity.position.entity_type}:${entity.position.entity_id}`
        setVisibleTypes(previous => [...new Set([...previous, 'workplace', 'employee'])])
        if (entity.position.floor_id === floor?.id) return setFocus({ key: focusKey, at: Date.now() })
        return changeFloor(entity.position.floor_id, { focusKey })
      }
      if (editing && entity.available && entity.placement_target) {
        const target = liveCatalog.find(row => markerKey(row) === markerKey(entity.placement_target))
        if (target) return pickEntity(target)
      }
      setEmployeeInfo(entity); return
    }
    setVisibleTypes(previous => [...new Set([...previous, entity.entity_type])])
    const key = markerKey(entity)
    const current = document.markers.find((marker) => markerKey(marker) === key)
    if (current) { setFocus({ key, at: Date.now() }); setSelected(`m:${key}`); return }
    if(entity.position?.entity_type==='network'){
      const focusKey=`network:${entity.position.entity_id}`
      if(entity.position.floor_id===floor?.id)return setFocus({key:focusKey,at:Date.now()})
      return changeFloor(entity.position.floor_id,{focusKey})
    }
    if (!editing) {
      if (entity.position) return changeFloor(entity.position.floor_id, { focusKey: `${entity.position.entity_type}:${entity.position.entity_id}` })
      message.info(floor ? 'Нажмите «Редактировать план», чтобы разместить объект' : 'Сначала создайте или выберите план этажа'); return
    }
    if (entity.available === false) return message.info('Архивную отметку можно выбрать на плане и снять, но нельзя размещать заново')
    if (building?.branch_id && entity.branch_id && building.branch_id !== entity.branch_id) return message.warning('Для размещения выберите здание филиала этого объекта')
    const place = () => { setPendingEntity(entity); setTool('select'); setSelected(null) }
    if (entity.position && !entity.position.inherited && entity.position.floor_id !== floor.id) {
      Modal.confirm({ title: 'Перенести отметку на этот этаж?', content: `Сейчас объект размещён: ${entity.position.building_name}, ${entity.position.floor_name}. Перенос произойдёт при сохранении плана.`,
        okText: 'Выбрать место', cancelText: 'Отмена', onOk: place })
    } else place()
  }
  const placeEntity = (entity, point) => {
    const position = entity.position
    const marker = { entity_type: entity.entity_type, entity_id: entity.entity_id, ...point, rotation: 0, room_id: roomAt(document, point)?.id || null,
      ...(position && !position.inherited && position.floor_id !== floor.id ? { from_floor_id: position.floor_id, from_revision: position.revision } : {}) }
    // A deep link can point at an already-placed object on the current plan.
    commit({ ...document, markers: [...document.markers.filter((row) => markerKey(row) !== markerKey(marker)), marker] })
    setSelected(`m:${markerKey(marker)}`); setPendingEntity(null)
  }
  const save = async () => {
    if (!floor || saving) return
    setSaving(true); setConflict('')
    try {
      const form = new FormData()
      form.append('document', JSON.stringify({ ...document, revision: draftBaseRevision ?? floor.revision }))
      if (backgroundFile) form.append('file', backgroundFile)
      const { data: next } = await api.put(`/maps/floors/${floor.id}`, form)
      const nextDocument = documentFromFloor(next)
      dirtyRef.current = false
      await clearDraft(floor.id)
      setFloor(next); dispatch({ type: 'reset', document: nextDocument }); setSavedJSON(JSON.stringify(nextDocument))
      setDraftBaseRevision(next.revision)
      setBackgroundFile(null)
      if (!next.has_background) { setServerBackground(null); setPreviewBackground(null) }
      else {
        try {
          const image = await api.get(`/maps/floors/${next.id}/background`, { responseType: 'blob' })
          setServerBackground(URL.createObjectURL(image.data)); setPreviewBackground(null)
        } catch { message.warning('План сохранён, но подложку с сервера загрузить не удалось') }
      }
      message.success('План сохранён')
      try { await refreshIndex() } catch { message.warning('План сохранён. Список объектов обновится после повторного открытия.') }
    } catch (error) {
      if (error.response?.status === 409) setConflict(errorText(error))
      else message.error(errorText(error))
    } finally { setSaving(false) }
  }
  const recoverDraft = async () => {
    if (!recoverableDraft || !floor) return
    const draft = recoverableDraft
    try {
      if (draft.backgroundFile) setPreviewBackground(URL.createObjectURL(draft.backgroundFile))
      else if (draft.document.background_revision && !draft.document.remove_background) {
        const image = await api.get(`/maps/floors/${floor.id}/versions/${draft.document.background_revision}/background`, { responseType: 'blob' })
        setPreviewBackground(URL.createObjectURL(image.data))
      }
      dispatch({ type: 'commit', document: bindRooms({network:{nodes:[],links:[]},network_revision:floor.network_revision,...draft.document}) })
      setBackgroundFile(draft.backgroundFile || null); setDraftBaseRevision(draft.base_revision)
      setEditing(true); setRecoverableDraft(null)
      if (draft.base_revision !== floor.revision) setConflict('Черновик основан на прежней версии. Серверный план изменился; сохранение поверх новой версии будет заблокировано. Черновик остаётся на этом устройстве.')
    } catch { message.error('Не удалось восстановить подложку черновика. Черновик сохранён; попробуйте ещё раз.') }
  }
  const loadVersion = async revision => {
    if (!floor || saving) return
    const floorId = floor.id
    setSaving(true)
    try {
      const [response, catalogResponse] = await Promise.all([api.get(`/maps/floors/${floorId}/versions/${revision}`), api.get('/maps/catalog')])
      const value = response.data, currentCatalog = catalogResponse.data
      const available = new Map(currentCatalog.map(entity => [markerKey(entity), entity]))
      const currentMarks = new Set(floor.markers.map(markerKey))
      const transfers = [], unavailable = []
      const markers = value.document.markers.filter(marker => {
        if (available.get(markerKey(marker))?.available || currentMarks.has(markerKey(marker))) return true
        unavailable.push(marker); return false
      }).map(marker => {
        const position = available.get(markerKey(marker))?.position
        if (position && !position.inherited && position.floor_id !== floorId) {
          transfers.push(marker)
          return { ...marker, from_floor_id: position.floor_id, from_revision: position.revision }
        }
        return marker
      })
      let image = null
      if (value.has_background) image = (await api.get(`/maps/floors/${floorId}/versions/${revision}/background`, { responseType: 'blob' })).data
      const apply = () => confirmDiscard(() => {
        setCatalog(currentCatalog); setBackgroundFile(null); setPreviewBackground(image ? URL.createObjectURL(image) : null)
        commit({ ...value.document, network:value.document.network||{nodes:[],links:[]},network_revision:floor.network_revision, markers, background_revision: revision, remove_background: !value.has_background, version_label: `Восстановлено из версии ${revision}` })
        setDraftBaseRevision(floor.revision); setEditing(true); setVersionsOpen(false); setSelected(null); setConflict('')
      })
      if (transfers.length || unavailable.length) Modal.confirm({ title: 'Загрузить прежнюю версию?',
        content: `Отметок, которые будут перенесены с других этажей при сохранении: ${transfers.length}. Недоступных отметок, которые пропускаются: ${unavailable.length}. Проверьте результат в редакторе.`,
        okText: 'Загрузить', cancelText: 'Отмена', onOk: apply })
      else apply()
    } catch (error) { message.error(errorText(error)) } finally { setSaving(false) }
  }
  const uploadBackground = (file) => {
    if (file.size > 10 * 1024 * 1024) { message.error('Подложка должна быть не больше 10 МБ'); return Upload.LIST_IGNORE }
    const request = ++backgroundRequestId.current
    const url = URL.createObjectURL(file), image = new Image()
    image.onload = () => {
      if (request !== backgroundRequestId.current) { URL.revokeObjectURL(url); return }
      setBackgroundSize({ width: image.naturalWidth, height: image.naturalHeight })
      setBackgroundFile(file); setPreviewBackground(url)
      commit({ ...documentRef.current, remove_background: false })
    }
    image.onerror = () => { URL.revokeObjectURL(url); if (request === backgroundRequestId.current) message.error('Не удалось прочитать изображение. Выберите JPEG, PNG или WebP.') }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      URL.revokeObjectURL(url); message.error('Поддерживаются JPEG, PNG и WebP'); return Upload.LIST_IGNORE
    }
    image.src = url
    return Upload.LIST_IGNORE
  }
  const onManaged = async (result, kind) => {
    setMode(null)
    await refreshIndex()
    if (kind === 'floor') confirmDiscard(() => { setParams({ floor: String(result.id) }); loadFloor(result.id, { placeKey: initialParams.current.get('place') }) })
    else if (kind === 'building') {
      confirmDiscard(() => { setBuildingId(result.id); setFloor(null); setEditing(false); setParams({}) })
    }
  }
  const deleteFloor = async () => {
    try {
      await api.delete(`/maps/floors/${floor.id}`, { params: { revision: floor.revision } })
      await clearDraft(floor.id)
      dirtyRef.current = false; setFloor(null); setEditing(false); setBackgroundFile(null)
      setServerBackground(null); setPreviewBackground(null); setParams({})
      const index = await refreshIndex()
      const next = index.find((row) => row.id === buildingId)?.floors[0]
      if (next) { setParams({ floor: String(next.id) }); await loadFloor(next.id) }
      message.success('План удалён. Карточки оборудования сохранены.')
    } catch (error) { message.error(errorText(error)) }
  }
  if (loading && !floor) return <Spin tip="Загрузка карты…"><div style={{ minHeight: 260 }} /></Spin>
  return <div className={`maps-page${fullscreen ? ' map-fullscreen' : ''}`}>
    <div className="map-page-heading"><div><Typography.Title level={3}>Карта зданий и помещений</Typography.Title>
      <Typography.Text type="secondary">Планы этажей, сотрудники и оборудование в одном месте</Typography.Text></div>
      <Space wrap>
        <Button icon={fullscreen ? <CompressOutlined /> : <ExpandOutlined />} onClick={() => setFullscreen(value => !value)}>{fullscreen ? 'Выйти из полного экрана' : 'Полный экран'}</Button>
        <Button icon={<PlusOutlined />} disabled={saving} onClick={() => setMode('building')}>Добавить здание</Button>
        {floor && <Button icon={<HistoryOutlined />} disabled={saving} onClick={() => setVersionsOpen(true)}>История планов</Button>}
        {floor && (editing ? <>
          <Tag color={dirty ? 'orange' : 'green'}>{dirty ? 'Есть несохранённые изменения' : 'Изменения сохранены'}</Tag>
          <Button disabled={saving} onClick={() => confirmDiscard(() => loadFloor(floor.id))}>Завершить редактирование</Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!dirty} onClick={save}>Сохранить план</Button>
        </> : <Button type="primary" disabled={loading} icon={<EditOutlined />} onClick={() => setEditing(true)}>Редактировать план</Button>)}
      </Space>
    </div>
    {loadError && <Alert type="error" showIcon message={loadError} action={<Button onClick={() => window.location.reload()}>Повторить</Button>} />}
    {conflict && <Alert type="warning" showIcon message="Не удалось сохранить изменения" description={conflict}
      action={<Button onClick={() => confirmDiscard(() => loadFloor(floor.id))}>Загрузить версию сервера</Button>} />}
    {recoverableDraft && <Alert showIcon type="warning" message="Найден несохранённый черновик на этом устройстве"
      description={`Сохранён ${new Date(recoverableDraft.saved_at).toLocaleString('ru-RU')}${recoverableDraft.base_revision !== floor?.revision ? '. Серверный план изменился после создания черновика.' : ''}`}
      action={<Space><Button type="primary" disabled={saving} onClick={recoverDraft}>Восстановить черновик</Button><Button disabled={saving} onClick={() => clearDraft(floor.id)}>Удалить черновик</Button></Space>} />}
    {draftStatus && <div className={`map-draft-status${draftStatus.startsWith('Не удалось') || draftStatus.includes('недоступны') ? ' draft-error' : ''}`} role="status">{draftStatus}</div>}
    <div className="map-view-controls">
      <Space wrap>
        <Button size="small" icon={sidebarOpen ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />} onClick={() => setSidebarOpen(value => !value)}>{sidebarOpen ? 'Скрыть список' : 'Показать список'}</Button>
        {floor && <Button size="small" onClick={() => setInspectorOpen(value => !value)}>{inspectorOpen ? 'Скрыть свойства' : 'Показать свойства'}</Button>}
        {floor && <Button size="small" disabled={saving || loading} onClick={() => confirmDiscard(() => loadFloor(floor.id))}>Обновить карту</Button>}
      </Space>
      {floor && <span className="map-summary">Кабинеты: {summary.rooms} · Рабочие места: {summary.workplaces} · Сотрудники: {summary.employees} · Свободно: {summary.vacant} · Принтеры: {summary.printers}</span>}
    </div>
    <div className={`map-workspace${sidebarOpen ? ' has-map-sidebar' : ''}${floor && inspectorOpen ? ' has-map-inspector' : ''}`}>
      {sidebarOpen && <aside className="map-sidebar">
        <div className="map-sidebar-section">
          <h4>Здание</h4>
          <Select aria-label="Здание" value={buildingId} disabled={saving || loading} placeholder="Выберите здание" style={{ width: '100%' }}
            options={buildings.map((row) => ({ value: row.id, label: row.name }))} onChange={(id) => confirmDiscard(() => {
              const next = buildings.find((row) => row.id === id)
              setBuildingId(id)
              if (next.floors.length) { setParams({ floor: String(next.floors[0].id) }); loadFloor(next.floors[0].id) }
              else { dirtyRef.current = false; setFloor(null); setEditing(false); setParams({}) }
            })} />
          {building && <>
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 8 }}>{[building.branch_name, building.address].filter(Boolean).join(' · ') || 'Без привязки к филиалу'}</Typography.Paragraph>
            <Space size={4}><Button size="small" disabled={saving} onClick={() => setMode('editBuilding')}>Изменить</Button>
              <Popconfirm title="Удалить пустое здание?" okText="Удалить" cancelText="Отмена" onConfirm={async () => {
                try { await api.delete(`/maps/buildings/${building.id}`); const next = await refreshIndex(); setBuildingId(next[0]?.id) }
                catch (error) { message.error(errorText(error)) }
              }}><Button size="small" danger disabled={saving || Boolean(building.floors.length)}>Удалить</Button></Popconfirm>
            </Space>
          </>}
          <div className="map-section-heading"><h4>Этажи / планы</h4><Button size="small" icon={<PlusOutlined />} disabled={!building || saving} onClick={() => setMode('floor')} aria-label="Добавить этаж" /></div>
          <div className="map-floor-list">{building?.floors.map((row) => <Button key={row.id} block type={floor?.id === row.id ? 'primary' : 'default'} disabled={saving || loading}
            onClick={() => changeFloor(row.id)}>{row.name}</Button>)}</div>
        </div>
        <div className="map-sidebar-section">
          <h4>{editing ? 'Разместить на плане' : 'Найти на карте'}</h4>
          <Input.Search aria-label="Поиск объектов карты" placeholder="Сотрудник, номер, оборудование" allowClear value={search} onChange={(event) => setSearch(event.target.value)} />
          <Select aria-label="Тип объекта карты" allowClear placeholder="Все объекты" value={entityType} onChange={setEntityType}
            style={{ width: '100%', marginTop: 8 }} options={Object.entries({...ENTITY_TYPES,network:'Сетевые узлы'}).map(([value, label]) => ({ value, label }))} />
          <Select aria-label="Контроль размещения" allowClear placeholder="Любое размещение" value={placementFilter} onChange={setPlacementFilter} style={{ width: '100%', marginTop: 8 }} options={[
            { value: 'floor', label: 'На текущем этаже' }, { value: 'unplaced', label: 'Не размещено на карте' },
            { value: 'archived', label: 'Архивные / неактивные' }, { value: 'mismatch', label: 'Изменился филиал' },
          ]} />
          <Typography.Paragraph type="secondary" className="map-catalog-help">{editing ? 'Поиск по всем зданиям. Выберите объект и место на плане. Сотрудник размещается через рабочее место.' : 'Поиск по всем зданиям и этажам. Нажмите кабинет, сотрудника или оборудование, чтобы перейти к нему.'}</Typography.Paragraph>
          <div className="map-catalog-totals">
            <button type="button" onClick={() => { setPlacementFilter('unplaced'); setEntityType(undefined); setSearch('') }}>Не размещено: {liveCatalog.filter(entity => entity.available !== false && !entity.position).length}</button>
            <button type="button" onClick={() => { setPlacementFilter('archived'); setEntityType(undefined); setSearch('') }}>Архив / неактивны: {liveCatalog.filter(entity => entity.available === false).length}</button>
            <button type="button" onClick={() => { setPlacementFilter('mismatch'); setEntityType(undefined); setSearch('') }}>Филиал изменился: {liveCatalog.filter(entity => entity.placement_warning).length}</button>
          </div>
          <div className="map-catalog">{matches.length ? matches.map((entity) => {
            const placed = Boolean(floor && entity.position?.floor_id === floor.id)
            return <button type="button" key={markerKey(entity)} disabled={loading || saving} className={`map-catalog-item${pendingEntity && markerKey(pendingEntity) === markerKey(entity) ? ' active' : ''}`} onClick={() => pickEntity(entity)}>
              <span className="map-catalog-type" style={{ color: ENTITY_COLORS[entity.entity_type] }}>{entity.category}</span>
              <strong>{entity.name}</strong>
              <span>{entity.entity_type === 'employee' ? [entity.position_name, entity.workplace_name, entity.department_name].filter(Boolean).join(' · ') || 'Рабочее место не назначено' : entity.employee_name || entity.inventory_number || entity.department_name || 'Без сотрудника / номера'}</span>
              <small>{entity.available === false ? 'Архив / неактивен · ' : ''}{entity.placement_warning ? '⚠ Филиал изменился · ' : ''}{placed ? `На этом плане${entity.position?.inherited ? ' · через рабочее место / принтер' : ''}` : entity.position ? `${entity.position.building_name} · ${entity.position.floor_name}${entity.position.inherited ? ' · через рабочее место / принтер' : ''}` : entity.unplaced_reason || 'Не размещён'}</small>
            </button>
          }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет подходящих объектов" />}</div>
        </div>
      </aside>}
      <main className="map-main">
        {floor ? <>
          <div className="map-floor-heading"><div><h2>{floor.name}</h2><Typography.Text type="secondary">{floor.updated_by ? `Сохранено: ${floor.updated_by}` : 'Новый план'} · {document.markers.length} отметок</Typography.Text></div>
            {editing && <Space wrap><Button icon={<SettingOutlined />} disabled={saving} onClick={() => setMode('parameters')}>Параметры плана</Button>
              <Popconfirm title="Удалить план этажа со всеми отметками?" description="Рабочие места и оборудование останутся в системе." okText="Удалить план" cancelText="Отмена" onConfirm={deleteFloor}>
                <Button danger disabled={saving} icon={<DeleteOutlined />}>Удалить план</Button>
              </Popconfirm></Space>}
          </div>
          <div className="map-layers-toolbar">
            <strong>Слои</strong><Checkbox.Group aria-label="Слои карты" value={visibleTypes} onChange={setVisibleTypes}
              options={['workplace', 'employee', 'device', 'warehouse_item'].map(value => ({ value, label: ENTITY_TYPES[value] }))} />
            <Checkbox checked={showLabels} onChange={event => setShowLabels(event.target.checked)}>Подписи</Checkbox>
            <Checkbox checked={showRoomDimensions} onChange={event => setShowRoomDimensions(event.target.checked)}>Размеры кабинетов</Checkbox>
            <Checkbox checked={highlightStatuses} onChange={event => setHighlightStatuses(event.target.checked)}>Подсветка состояний</Checkbox>
          </div>
          {network.toolbar}
          {editing && <div className="map-drawing-toolbar">
            <Space wrap size={4}>{Object.entries({...MAP_TOOLS,measure:'Измерить расстояние'}).map(([value, label]) => <Button key={value} disabled={saving} type={tool === value && !pendingEntity ? 'primary' : 'default'} onClick={() => changeTool(value)}>{label}</Button>)}
              <Tooltip title="Отменить (Ctrl+Z)"><Button aria-label="Отменить изменение плана" icon={<UndoOutlined />} disabled={!state.past.length || saving} onClick={() => dispatch({ type: 'undo' })} /></Tooltip>
              <Tooltip title="Повторить (Ctrl+Shift+Z)"><Button aria-label="Повторить изменение плана" icon={<RedoOutlined />} disabled={!state.future.length || saving} onClick={() => dispatch({ type: 'redo' })} /></Tooltip>
            </Space>
            <Space wrap size={4}>
              <Typography.Text type="secondary">Выделено: {selection.length} · Тяните свободное место для рамки · Shift — добавить к выделению</Typography.Text>
              <Tooltip title="Копируются кабинеты, столы и элементы рисунка. Оборудование и рабочие места добавляются из списка."><Button size="small" icon={<CopyOutlined />} disabled={saving || !selection.length} onClick={() => { clipboard.current = copySelection(document, selection); paste() }}>Дублировать</Button></Tooltip>
              <Button size="small" disabled={saving || selection.length < 2} onClick={() => commit(groupSelection(document, selection, newShapeId()))}>Группировать</Button>
              <Button size="small" disabled={saving || !selection.length} onClick={() => commit(groupSelection(document, expandedSelection(document, selection), null))}>Разгруппировать</Button>
              <Button size="small" danger disabled={saving || !selection.length} onClick={removeSelected}>Удалить выделенное</Button>
            </Space>
            <MapEditingTools document={document} selection={selection} selected={selected} disabled={saving} onChange={commit} onSelection={keys=>{setSelection(keys);setPrimarySelected(keys.at(-1)||null)}} guides={smartSnap} onGuides={setSmartSnap} measurements={measurements} onMeasurements={setMeasurements} reference={reference} onReference={setReference} />
            <Space wrap><Checkbox checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)}>Сетка</Checkbox>
              <Checkbox checked={wallSnap} onChange={event => setWallSnap(event.target.checked)}>Привязка к стенам</Checkbox>
              <Select aria-label="Шаг сетки" value={gridStep} onChange={setGridStep} options={[{ value: 0, label: 'Без привязки' }, { value: 0.5, label: 'Шаг 0,5 м' }, { value: 1, label: 'Шаг 1 м' }]} />
              <Upload accept="image/jpeg,image/png,image/webp" beforeUpload={uploadBackground} showUploadList={false} disabled={saving}>
                <Button icon={<FileImageOutlined />} disabled={saving}>Загрузить подложку</Button>
              </Upload>
            </Space>
            <Input aria-label="Название сохраняемой версии" maxLength={200} placeholder="Название версии, например: Перестановка в бухгалтерии" value={document.version_label || ''} onChange={event => commit({ ...document, version_label: event.target.value })} disabled={saving} />
          </div>}
          {pendingEntity && <Alert showIcon type="info" closable onClose={() => setPendingEntity(null)}
            message={`Нажмите на план, чтобы разместить: ${pendingEntity.name}${pendingEntity.employee_name ? ` · ${pendingEntity.employee_name}` : ''}`} />}
          {editing && (serverBackground || previewBackground) && !document.remove_background && <div className="map-background-toolbar">
            <span>Прозрачность подложки</span><Slider aria-label="Видимость подложки" min={0} max={1} step={0.05} value={document.background_opacity} disabled={saving} onChange={(value) => commit({ ...document, background_opacity: value })} style={{ width: 140 }} />
            {backgroundSize && <Button size="small" disabled={saving} onClick={() => {
              const height = Math.round(document.width * backgroundSize.height / backgroundSize.width * 100) / 100
              const next = { ...document, height }
              if (height < 2 || height > 500 || !fits(next)) message.error('Пропорции изображения обрезают рисунок или выходят за пределы 2–500 м')
              else commit(next)
            }}>Пропорции изображения</Button>}
            <Button size="small" disabled={saving} onClick={() => { setBackgroundFile(null); setPreviewBackground(null); commit({ ...document, remove_background: true }) }}>Убрать подложку</Button>
          </div>}
          <Spin spinning={loading}>
            <FloorPlanCanvas floorId={floor.id} document={document} onChange={commit} editing={editing} saving={saving || loading} tool={tool} onToolChange={changeTool}
              selected={selected} selection={selection} onSelect={setSelected} pendingEntity={pendingEntity} onPlaced={placeEntity} entities={entities}
              backgroundUrl={previewBackground || serverBackground} showGrid={showGrid} gridStep={gridStep} focus={focus}
              visibleTypes={visibleTypes} showLabels={showLabels} highlightStatuses={highlightStatuses} wallSnap={wallSnap}
              networkLayer={network.overlay} networkNodes={network.nodes} smartSnap={smartSnap} measurements={measurements} showRoomDimensions={showRoomDimensions} reference={selection.includes(reference)?reference:selected}
              onSelection={keys=>{network.clearSelection();setSelection(keys);setPrimarySelected(keys.at(-1)||null);if(keys.length)setInspectorOpen(true)}}
              onOpen={(entity) => { if (entity?.path) confirmDiscard(() => navigate(entity.path)) }} />
          </Spin>
          {editing && !document.shapes.length && <Typography.Paragraph type="secondary" style={{ padding: '12px 16px' }}>Выберите «Комната», «Стена» или «Дверь» и протяните линию на плане. Выбор и перетаскивание меняют положение, синий маркер — размер. Delete удаляет выбранное; Esc отменяет размещение.</Typography.Paragraph>}
        </> : <div className="map-empty-state"><Empty description={building ? 'У здания пока нет планов этажей' : 'Добавьте первое здание, чтобы создать интерактивную карту'} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setMode(building ? 'floor' : 'building')}>{building ? 'Создать план этажа' : 'Добавить здание'}</Button></div>}
      </main>
      {floor && inspectorOpen && <aside className="map-inspector-panel"><h4>На плане</h4>{network.inspector || <Inspector selected={selected} document={document} entities={entities}
        departments={departments.filter(department => !building?.branch_id || department.branch_id === building.branch_id)} editable={editing && !saving && !loading}
        onChange={commit} onDelete={removeSelected} onOpen={(entity) => confirmDiscard(() => navigate(entity.path))} />}</aside>}
    </div>
    <SettingsModal mode={mode} building={building} document={document} branches={branches} onClose={() => setMode(null)} onSaved={onManaged}
      onParameters={(values) => { commit({ ...document, ...values }); setMode(null) }} />
    <MapVersionsModal open={versionsOpen} floor={floor} onClose={() => setVersionsOpen(false)} onRestore={loadVersion} />
    <Modal open={Boolean(employeeInfo)} title={employeeInfo?.name || 'Сотрудник'} onCancel={() => setEmployeeInfo(null)} footer={<Button onClick={() => setEmployeeInfo(null)}>Закрыть</Button>}>
      {employeeInfo && <><Alert type="info" showIcon message={employeeInfo.available === false ? 'Сотрудник неактивен' : employeeInfo.unplaced_reason || 'Сотрудник ещё не размещён на плане'} style={{ marginBottom: 16 }} />
        <Descriptions column={1} items={[
          { key: 'position', label: 'Должность', children: employeeInfo.position_name || '—' },
          { key: 'branch', label: 'Филиал', children: employeeInfo.branch_name || '—' },
          { key: 'department', label: 'Отдел', children: employeeInfo.department_name || '—' },
          { key: 'workplace', label: 'Рабочее место', children: employeeInfo.workplace_name || 'Не назначено' },
          { key: 'email', label: 'Email', children: employeeInfo.email || '—' },
          { key: 'phone', label: 'Телефон', children: employeeInfo.phone || '—' },
        ]} /><Button onClick={() => { setEmployeeInfo(null); confirmDiscard(() => navigate(employeeInfo.path)) }}>{employeeInfo.workplace_id ? 'Открыть рабочее место' : 'Открыть список сотрудников'}</Button>
      </>}
    </Modal>
  </div>
}
