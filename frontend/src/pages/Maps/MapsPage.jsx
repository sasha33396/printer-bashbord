import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, Button, Checkbox, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select, Slider, Space, Spin, Tag, Tooltip, Typography, Upload, message } from 'antd'
import { ApartmentOutlined, DeleteOutlined, EditOutlined, FileImageOutlined, PlusOutlined, RedoOutlined, SaveOutlined, SettingOutlined, UndoOutlined } from '@ant-design/icons'
import api from '../../api/api'
import FloorPlanCanvas from '../../components/FloorPlanCanvas'
import { documentFromFloor, ENTITY_COLORS, ENTITY_TYPES, filterMapCatalog, historyReducer, MAP_TOOLS, markerKey, translateElement } from '../../utils/floorPlans'
import './maps.css'

const EMPTY_DOCUMENT = { name: '', width: 40, height: 25, background_opacity: 0.4, remove_background: false, shapes: [], markers: [] }
const errorText = (error) => {
  const detail = error.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map((row) => row.msg).join('; ')
  return error.response?.status === 413 ? 'Файл подложки слишком большой. Допускается до 10 МБ.' : 'Не удалось выполнить операцию. Проверьте соединение.'
}
const fits = (document) => document.shapes.every((shape) => shape.x <= document.width && shape.y <= document.height
  && (shape.x2 ?? 0) <= document.width && (shape.y2 ?? 0) <= document.height
  && (shape.kind !== 'room' || (shape.x + shape.width <= document.width && shape.y + shape.height <= document.height)))
  && document.markers.every((marker) => marker.x <= document.width && marker.y <= document.height)

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

function Inspector({ selected, document, entities, editable, onChange, onDelete, onOpen }) {
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
    update(translateElement(element, { x: axis === 'x' ? value - element.x : 0, y: axis === 'y' ? value - element.y : 0 }, document))
  }
  return <div className="map-inspector">
    <Typography.Title level={5}>{entity?.name || ({ room: 'Комната', wall: 'Стена', door: 'Дверь', text: 'Подпись' }[shape?.kind]) || 'Объект удалён'}</Typography.Title>
    {entity && <>
      <Tag color={ENTITY_COLORS[marker.entity_type]}>{entity.category}</Tag>
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
    <Form layout="vertical" disabled={!editable}>
      {shape && !['wall', 'door'].includes(shape.kind) && <Form.Item label="Подпись"><Input aria-label="Подпись элемента" maxLength={200} value={shape.label} onChange={(event) => update({ label: event.target.value })} /></Form.Item>}
      <div className="map-coordinate-fields">
        <Form.Item label="X, м"><InputNumber aria-label="Координата X" value={element.x} min={0} max={document.width} step={0.5} onChange={(value) => coordinate('x', value)} /></Form.Item>
        <Form.Item label="Y, м"><InputNumber aria-label="Координата Y" value={element.y} min={0} max={document.height} step={0.5} onChange={(value) => coordinate('y', value)} /></Form.Item>
      </div>
      {shape?.kind === 'room' && <div className="map-coordinate-fields">
        <Form.Item label="Ширина, м"><InputNumber aria-label="Ширина комнаты" value={shape.width} min={0.5} max={document.width - shape.x} step={0.5} onChange={(value) => { if (value >= 0.5) update({ width: value }) }} /></Form.Item>
        <Form.Item label="Длина, м"><InputNumber aria-label="Длина комнаты" value={shape.height} min={0.5} max={document.height - shape.y} step={0.5} onChange={(value) => { if (value >= 0.5) update({ height: value }) }} /></Form.Item>
      </div>}
      {shape && ['wall', 'door'].includes(shape.kind) && <div className="map-coordinate-fields">
        <Form.Item label="Конец X, м"><InputNumber aria-label="Конец X" value={shape.x2} min={0} max={document.width} step={0.5} onChange={(value) => { if (value != null) update({ x2: value }) }} /></Form.Item>
        <Form.Item label="Конец Y, м"><InputNumber aria-label="Конец Y" value={shape.y2} min={0} max={document.height} step={0.5} onChange={(value) => { if (value != null) update({ y2: value }) }} /></Form.Item>
      </div>}
      {shape && ['room', 'text'].includes(shape.kind) && <Form.Item label="Цвет"><input aria-label="Цвет элемента" type="color" value={shape.color} disabled={!editable} onChange={(event) => update({ color: event.target.value })} /></Form.Item>}
      {marker && <Form.Item label="Поворот, °"><InputNumber aria-label="Поворот объекта" value={marker.rotation || 0} min={0} max={359} step={15} onChange={(value) => { if (value != null) update({ rotation: value }) }} /></Form.Item>}
    </Form>
    {editable && <Button danger block icon={<DeleteOutlined />} onClick={onDelete}>{marker ? 'Снять отметку с карты' : 'Удалить элемент плана'}</Button>}
    {marker && <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>Снятие отметки сохраняет карточку и историю оборудования. Перемещения между филиалами оформляются в карточках.</Typography.Paragraph>}
  </div>
}

export default function MapsPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const initialParams = useRef(params)
  const [buildings, setBuildings] = useState([])
  const [branches, setBranches] = useState([])
  const [catalog, setCatalog] = useState([])
  const [buildingId, setBuildingId] = useState()
  const [floor, setFloor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [mode, setMode] = useState(null)
  const [selected, setSelected] = useState(null)
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
  const dirty = Boolean(floor && (JSON.stringify(document) !== savedJSON || backgroundFile))
  const documentRef = useRef(document)
  const dirtyRef = useRef(dirty)
  documentRef.current = document
  dirtyRef.current = dirty
  const requestId = useRef(0)
  const backgroundRequestId = useRef(0)
  const building = buildings.find((row) => row.id === buildingId)
  const commit = (next) => dispatch({ type: 'commit', document: next })
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
      okText: 'Отбросить', cancelText: 'Остаться', okButtonProps: { danger: true }, onOk: callback })
  }, [])
  const refreshIndex = async () => {
    const [indexResponse, catalogResponse] = await Promise.all([api.get('/maps/buildings'), api.get('/maps/catalog')])
    setBuildings(indexResponse.data); setCatalog(catalogResponse.data)
    return indexResponse.data
  }
  const loadFloor = useCallback(async (id, { focusKey, placeKey } = {}) => {
    const request = ++requestId.current
    backgroundRequestId.current += 1
    setLoading(true); setLoadError('')
    try {
      const [response, catalogResponse] = await Promise.all([api.get(`/maps/floors/${id}`), api.get('/maps/catalog')])
      if (request !== requestId.current) return
      const next = response.data, nextDocument = documentFromFloor(next)
      setFloor(next); setBuildingId(next.building_id); setCatalog(catalogResponse.data)
      dispatch({ type: 'reset', document: nextDocument }); setSavedJSON(JSON.stringify(nextDocument))
      setSelected(null); setPendingEntity(null); setTool('select'); setEditing(false); setConflict('')
      setBackgroundFile(null); setPreviewBackground(null); setServerBackground(null); setBackgroundSize(null)
      localStorage.setItem('map_floor_id', String(id))
      setFocus(focusKey ? { key: focusKey, at: Date.now() } : null)
      if (placeKey) {
        const entity = catalogResponse.data.find((row) => markerKey(row) === placeKey)
        if (entity) { setEditing(true); setPendingEntity(entity) }
      }
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
        const [indexResponse, branchResponse, catalogResponse] = await Promise.all([
          api.get('/maps/buildings'), api.get('/orgs/branches'), api.get('/maps/catalog'),
        ])
        if (cancelled) return
        setBuildings(indexResponse.data); setBranches(branchResponse.data); setCatalog(catalogResponse.data)
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
    const beforeUnload = (event) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = '' } }
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
  }, [confirmDiscard, navigate])

  const removeSelected = useCallback(() => {
    if (!editing || saving || !selected) return
    const current = documentRef.current
    commit({ ...current, shapes: current.shapes.filter((row) => `s:${row.id}` !== selected),
      markers: current.markers.filter((row) => `m:${markerKey(row)}` !== selected) })
    setSelected(null)
  }, [selected, editing, saving])
  useEffect(() => {
    const keydown = (event) => {
      if (!editing || saving || event.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); dispatch({ type: event.shiftKey ? 'redo' : 'undo' })
      } else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected() }
      else if (event.key === 'Escape') { setPendingEntity(null); setTool('select'); setSelected(null) }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [editing, saving, removeSelected])

  const entities = useMemo(() => Object.fromEntries([
    ...catalog.map((entity) => [markerKey(entity), entity]),
    ...(floor?.markers || []).map((marker) => [markerKey(marker), marker.entity]),
  ]), [catalog, floor])
  const matches = useMemo(() => filterMapCatalog(catalog, { search, type: entityType, branchId: building?.branch_id }), [catalog, search, entityType, building])
  const changeTool = (next) => { setTool(next); setPendingEntity(null) }
  const changeFloor = (id, options) => confirmDiscard(() => { setParams({ floor: String(id) }); loadFloor(id, options) })
  const pickEntity = (entity) => {
    const key = markerKey(entity)
    const current = document.markers.find((marker) => markerKey(marker) === key)
    if (current) { setFocus({ key, at: Date.now() }); setSelected(`m:${key}`); return }
    if (!editing) {
      if (entity.position) return changeFloor(entity.position.floor_id, { focusKey: `${entity.position.entity_type}:${entity.position.entity_id}` })
      message.info('Нажмите «Редактировать», чтобы разместить объект на текущем плане'); return
    }
    const place = () => { setPendingEntity(entity); setTool('select'); setSelected(null) }
    if (entity.position && !entity.position.inherited && entity.position.floor_id !== floor.id) {
      Modal.confirm({ title: 'Перенести отметку на этот этаж?', content: `Сейчас объект размещён: ${entity.position.building_name}, ${entity.position.floor_name}. Перенос произойдёт при сохранении плана.`,
        okText: 'Выбрать место', cancelText: 'Отмена', onOk: place })
    } else place()
  }
  const placeEntity = (entity, point) => {
    const position = entity.position
    const marker = { entity_type: entity.entity_type, entity_id: entity.entity_id, ...point, rotation: 0,
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
      form.append('document', JSON.stringify({ ...document, revision: floor.revision }))
      if (backgroundFile) form.append('file', backgroundFile)
      const { data: next } = await api.put(`/maps/floors/${floor.id}`, form)
      const nextDocument = documentFromFloor(next)
      setFloor(next); dispatch({ type: 'reset', document: nextDocument }); setSavedJSON(JSON.stringify(nextDocument))
      setBackgroundFile(null)
      if (!next.has_background) { setServerBackground(null); setPreviewBackground(null) }
      else if (backgroundFile) {
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
    if (kind === 'floor') { setParams({ floor: String(result.id) }); await loadFloor(result.id, { placeKey: initialParams.current.get('place') }) }
    else if (kind === 'building') {
      confirmDiscard(() => { setBuildingId(result.id); setFloor(null); setEditing(false); setParams({}) })
    }
  }
  const deleteFloor = async () => {
    try {
      await api.delete(`/maps/floors/${floor.id}`, { params: { revision: floor.revision } })
      dirtyRef.current = false; setFloor(null); setEditing(false); setBackgroundFile(null)
      setServerBackground(null); setPreviewBackground(null); setParams({})
      const index = await refreshIndex()
      const next = index.find((row) => row.id === buildingId)?.floors[0]
      if (next) { setParams({ floor: String(next.id) }); await loadFloor(next.id) }
      message.success('План удалён. Карточки оборудования сохранены.')
    } catch (error) { message.error(errorText(error)) }
  }
  if (loading && !floor) return <Spin tip="Загрузка карты…"><div style={{ minHeight: 260 }} /></Spin>
  return <div className="maps-page">
    <div className="map-page-heading"><div><Typography.Title level={3}>Карта зданий и помещений</Typography.Title>
      <Typography.Text type="secondary">Планы этажей, сотрудники и оборудование в одном месте</Typography.Text></div>
      <Space wrap>
        <Button icon={<PlusOutlined />} disabled={saving} onClick={() => setMode('building')}>Добавить здание</Button>
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
    <div className="map-workspace">
      <aside className="map-sidebar">
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
        {floor && <div className="map-sidebar-section">
          <h4>{editing ? 'Разместить на плане' : 'Найти на карте'}</h4>
          <Input.Search aria-label="Поиск объектов карты" placeholder="Сотрудник, номер, оборудование" allowClear value={search} onChange={(event) => setSearch(event.target.value)} />
          <Select aria-label="Тип объекта карты" allowClear placeholder="Все объекты" value={entityType} onChange={setEntityType}
            style={{ width: '100%', marginTop: 8 }} options={Object.entries(ENTITY_TYPES).map(([value, label]) => ({ value, label }))} />
          <Typography.Paragraph type="secondary" className="map-catalog-help">{editing ? 'Выберите объект, затем нажмите на нужное место плана.' : 'Нажмите объект, чтобы найти его отметку. Сотрудники указаны у рабочих мест.'}</Typography.Paragraph>
          <div className="map-catalog">{matches.length ? matches.map((entity) => {
            const placed = document.markers.some((marker) => markerKey(marker) === markerKey(entity))
            return <button type="button" key={markerKey(entity)} disabled={loading || saving} className={`map-catalog-item${pendingEntity && markerKey(pendingEntity) === markerKey(entity) ? ' active' : ''}`} onClick={() => pickEntity(entity)}>
              <span className="map-catalog-type" style={{ color: ENTITY_COLORS[entity.entity_type] }}>{entity.category}</span>
              <strong>{entity.name}</strong>
              <span>{entity.employee_name || entity.inventory_number || entity.department_name || 'Без сотрудника / номера'}</span>
              <small>{placed ? 'На этом плане' : entity.position ? `${entity.position.building_name} · ${entity.position.floor_name}${entity.position.inherited ? ' · через рабочее место / принтер' : ''}` : 'Не размещён'}</small>
            </button>
          }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Нет подходящих объектов" />}</div>
        </div>}
      </aside>
      <main className="map-main">
        {floor ? <>
          <div className="map-floor-heading"><div><h2>{floor.name}</h2><Typography.Text type="secondary">{floor.updated_by ? `Сохранено: ${floor.updated_by}` : 'Новый план'} · {document.markers.length} отметок</Typography.Text></div>
            {editing && <Space wrap><Button icon={<SettingOutlined />} disabled={saving} onClick={() => setMode('parameters')}>Параметры плана</Button>
              <Popconfirm title="Удалить план этажа со всеми отметками?" description="Рабочие места и оборудование останутся в системе." okText="Удалить план" cancelText="Отмена" onConfirm={deleteFloor}>
                <Button danger disabled={saving} icon={<DeleteOutlined />}>Удалить план</Button>
              </Popconfirm></Space>}
          </div>
          {editing && <div className="map-drawing-toolbar">
            <Space wrap size={4}>{Object.entries(MAP_TOOLS).map(([value, label]) => <Button key={value} disabled={saving} type={tool === value && !pendingEntity ? 'primary' : 'default'} onClick={() => changeTool(value)}>{label}</Button>)}
              <Tooltip title="Отменить (Ctrl+Z)"><Button aria-label="Отменить изменение плана" icon={<UndoOutlined />} disabled={!state.past.length || saving} onClick={() => dispatch({ type: 'undo' })} /></Tooltip>
              <Tooltip title="Повторить (Ctrl+Shift+Z)"><Button aria-label="Повторить изменение плана" icon={<RedoOutlined />} disabled={!state.future.length || saving} onClick={() => dispatch({ type: 'redo' })} /></Tooltip>
            </Space>
            <Space wrap><Checkbox checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)}>Сетка</Checkbox>
              <Select aria-label="Шаг сетки" value={gridStep} onChange={setGridStep} options={[{ value: 0, label: 'Без привязки' }, { value: 0.5, label: 'Шаг 0,5 м' }, { value: 1, label: 'Шаг 1 м' }]} />
              <Upload accept="image/jpeg,image/png,image/webp" beforeUpload={uploadBackground} showUploadList={false} disabled={saving}>
                <Button icon={<FileImageOutlined />} disabled={saving}>Загрузить подложку</Button>
              </Upload>
            </Space>
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
              selected={selected} onSelect={setSelected} pendingEntity={pendingEntity} onPlaced={placeEntity} entities={entities}
              backgroundUrl={previewBackground || serverBackground} showGrid={showGrid} gridStep={gridStep} focus={focus}
              onOpen={(entity) => { if (entity?.path) confirmDiscard(() => navigate(entity.path)) }} />
          </Spin>
          {editing && !document.shapes.length && <Typography.Paragraph type="secondary" style={{ padding: '12px 16px' }}>Выберите «Комната», «Стена» или «Дверь» и протяните линию на плане. Выбор и перетаскивание меняют положение, синий маркер — размер. Delete удаляет выбранное; Esc отменяет размещение.</Typography.Paragraph>}
        </> : <div className="map-empty-state"><Empty description={building ? 'У здания пока нет планов этажей' : 'Добавьте первое здание, чтобы создать интерактивную карту'} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setMode(building ? 'floor' : 'building')}>{building ? 'Создать план этажа' : 'Добавить здание'}</Button></div>}
      </main>
      {floor && <aside className="map-inspector-panel"><h4>На плане</h4><Inspector selected={selected} document={document} entities={entities} editable={editing && !saving && !loading}
        onChange={commit} onDelete={removeSelected} onOpen={(entity) => confirmDiscard(() => navigate(entity.path))} /></aside>}
    </div>
    <SettingsModal mode={mode} building={building} document={document} branches={branches} onClose={() => setMode(null)} onSaved={onManaged}
      onParameters={(values) => { commit({ ...document, ...values }); setMode(null) }} />
  </div>
}
