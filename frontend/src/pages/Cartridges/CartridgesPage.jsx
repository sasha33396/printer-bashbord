import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Alert, Button, Card, DatePicker, Descriptions, Form, Input, Modal, Select, Space, Spin, Tabs, Tag, Typography, message } from 'antd'
import dayjs from 'dayjs'
import api from '../../api/api'
import Table from '../../components/FilterableTable'
import { printBarcodeLabel } from '../../utils/barcode'
import { actionAllowed, cartridgeSummary, CARTRIDGE_STATES, CARTRIDGE_OPERATIONS, STATE_COLORS } from '../../utils/cartridges'

const fmtDate = (value) => value ? dayjs(value).format('DD.MM.YYYY') : '—'
const failure = (error) => {
  const detail = error.response?.data?.detail
  message.error(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((item) => item.msg).join('; ') : 'Не удалось выполнить операцию')
}
const options = (rows, label = 'name') => rows.map((item) => ({ value: item.id, label: item[label] }))
const operationColumns = [
  { title: 'Дата', dataIndex: 'date', render: fmtDate },
  { title: 'Номер наклейки', dataIndex: 'inventory_number' },
  { title: 'Модель', dataIndex: 'name' },
  { title: 'Операция', dataIndex: 'operation', render: (value) => CARTRIDGE_OPERATIONS[value] || value },
  { title: 'Откуда', dataIndex: 'from_location', render: (value) => value || '—' },
  { title: 'Куда', dataIndex: 'to_location' },
  { title: 'Состояние', dataIndex: 'to_state', render: (value) => CARTRIDGE_STATES[value] || value },
  { title: 'Принтер', dataIndex: 'device_name', render: (value) => value || '—' },
  { title: 'Подрядчик', dataIndex: 'contractor', render: (value) => value || '—' },
  { title: 'Кто оформил', dataIndex: 'actor' },
  { title: 'Примечание', dataIndex: 'notes' },
]

function DestinationFields({ form, branches, departments, employees, installing = false }) {
  const holder = Form.useWatch(['destination', 'holder_type'], form)
  const branch = Form.useWatch(['destination', 'branch_id'], form)
  const department = Form.useWatch(['destination', 'department_id'], form)
  return <>
    <Form.Item name={['destination', 'holder_type']} label="Получатель" rules={[{ required: true }]}>
      <Select options={[
        ...(!installing ? [{ value: 'warehouse', label: 'Склад' }] : []),
        { value: 'department', label: 'Отдел' }, { value: 'employee', label: 'Сотрудник' },
      ]} onChange={() => form.setFieldValue(['destination', 'employee_id'], undefined)} />
    </Form.Item>
    <Form.Item name={['destination', 'branch_id']} label="Филиал" rules={[{ required: true }]}>
      <Select showSearch optionFilterProp="label" options={options(branches)} onChange={() => {
        form.setFieldValue(['destination', 'department_id'], undefined)
        form.setFieldValue(['destination', 'employee_id'], undefined)
      }} />
    </Form.Item>
    <Form.Item name={['destination', 'department_id']} label="Отдел" rules={[{ required: holder === 'department' || installing }]}>
      <Select allowClear showSearch optionFilterProp="label" options={options(departments.filter((row) => row.branch_id === branch))}
        onChange={() => form.setFieldValue(['destination', 'employee_id'], undefined)} />
    </Form.Item>
    {holder === 'employee' && <Form.Item name={['destination', 'employee_id']} label="Сотрудник" rules={[{ required: true }]}>
      <Select showSearch optionFilterProp="label" options={options(employees.filter((row) => row.is_active
        && row.branch_id === branch && (row.department_id ?? null) === (department ?? null)), 'full_name')} />
    </Form.Item>}
  </>
}

function CartridgeModal({ mode, initialIds, data, onClose, onSaved, initialDevice }) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const deviceId = Form.useWatch('device_id', form)
  const slot = Form.useWatch('slot', form)
  const sourceId = Form.useWatch('source_item_id', form)
  const createBranch = Form.useWatch('branch_id', form)
  const selectedIds = Form.useWatch('item_ids', form) || []
  const { items, branches, departments, employees, devices, warehouse } = data
  const legacy = warehouse.filter((item) => item.category === 'Картриджи' && !item.is_archived && !item.cartridge_managed)
  const outgoing = items.find((item) => item.device_id === deviceId && item.slot === slot)

  useEffect(() => {
    if (!mode) return
    form.resetFields()
    const first = items.find((item) => item.item_id === initialIds[0])
    form.setFieldsValue({
      date: dayjs(), state: 'ready', result: 'ready', slot: 'Основной',
      item_ids: initialIds, item_id: first?.state === 'ready' ? first.item_id : undefined,
      destination: { holder_type: mode === 'install' ? 'department' : 'warehouse', branch_id: first?.branch_id, department_id: first?.department_id },
      device_id: initialDevice,
    })
  }, [mode, initialIds, form]) // Reloaded data must not reset an open form.

  useEffect(() => {
    if (mode !== 'install' || !deviceId) return
    const device = devices.find((row) => row.id === deviceId)
    form.setFieldsValue({ destination: { holder_type: 'department', employee_id: undefined,
      branch_id: device?.department?.branch?.id, department_id: device?.department_id } })
  }, [deviceId, mode, devices, form])

  const save = async () => {
    let values
    try { values = await form.validateFields() } catch { return }
    setSaving(true)
    try {
      const date = values.date.format('YYYY-MM-DD')
      const destination = values.destination && {
        ...values.destination, department_id: values.destination.department_id ?? null,
        employee_id: values.destination.holder_type === 'employee' ? values.destination.employee_id : null,
      }
      if (mode === 'create') {
        const inventory_numbers = values.inventory_numbers.split(/[\s,;]+/).filter(Boolean)
        await api.post('/cartridges', { ...values, date, inventory_numbers, department_id: values.department_id ?? null })
      } else if (mode === 'install') {
        await api.post('/cartridges/install', { item_id: values.item_id, device_id: values.device_id, slot: values.slot,
          removed_item_id: outgoing?.item_id ?? null, date, destination, notes: values.notes })
      } else {
        await api.post('/cartridges/actions', { item_ids: values.item_ids, operation: mode, date,
          ...(['transfer', 'return_refill', 'remove'].includes(mode) ? { destination } : {}),
          ...(mode === 'send_refill' ? { contractor: values.contractor } : {}),
          ...(mode === 'return_refill' ? { result: values.result } : {}), notes: values.notes })
      }
      message.success('Операция сохранена')
      onSaved()
    } catch (error) { failure(error) } finally { setSaving(false) }
  }
  return <Modal open={Boolean(mode)} title={mode === 'create' ? 'Добавить картриджи с наклейками' : CARTRIDGE_OPERATIONS[mode]}
    onCancel={() => { if (!saving) onClose() }} onOk={save} confirmLoading={saving} okText="Сохранить" cancelText="Отмена"
    maskClosable={!saving} closable={!saving} cancelButtonProps={{ disabled: saving }} width={650} destroyOnClose>
    <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
      {mode === 'create' ? <>
        <Form.Item name="source_item_id" label="Источник" extra="Для старых остатков выберите складскую позицию: её количество уменьшится на число введённых наклеек.">
          <Select allowClear showSearch optionFilterProp="label" placeholder="Новое поступление" options={legacy.map((row) => ({
            value: row.id, label: `${row.name} — ${row.branch?.name || 'Без филиала'} / ${row.department?.name || 'Без отдела'}; ${row.tracking_type === 'asset' ? row.inventory_number || 'без номера' : `${row.current_quantity} шт.`}`,
          }))} onChange={(value) => {
            const source = legacy.find((row) => row.id === value)
            if (source) form.setFieldsValue({ name: source.name, compatible_printers: source.compatible_printers,
              branch_id: source.branch_id, department_id: source.department_id,
              inventory_numbers: source.tracking_type === 'asset' ? source.inventory_number : '' })
          }} />
        </Form.Item>
        <Form.Item name="name" label="Модель / наименование" rules={[{ required: true, whitespace: true }]}><Input maxLength={255} /></Form.Item>
        <Form.Item name="compatible_printers" label="Совместимые принтеры"><Input maxLength={2000} /></Form.Item>
        <Form.Item name="inventory_numbers" label="Номера наклеек" extra="Формат 1-00001. По одному на строку или через пробел; до 100 за раз."
          rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={3} placeholder={'1-00301\n1-00302'} /></Form.Item>
        <Form.Item name="branch_id" label="Филиал" rules={[{ required: true }]}>
          <Select disabled={Boolean(sourceId)} options={options(branches)} onChange={() => form.setFieldValue('department_id', undefined)} />
        </Form.Item>
        <Form.Item name="department_id" label="Отдел"><Select allowClear disabled={Boolean(sourceId)} options={options(departments.filter((row) => row.branch_id === createBranch))} /></Form.Item>
        <Form.Item name="state" label="Начальное состояние" rules={[{ required: true }]}
          extra="Для состояния «Установлен» после добавления нажмите «Установить» и выберите принтер.">
          <Select options={['ready', 'empty', 'defective'].map((value) => ({ value, label: CARTRIDGE_STATES[value] }))} />
        </Form.Item>
      </> : mode === 'install' ? <>
        <Form.Item name="device_id" label="Принтер" rules={[{ required: true }]}>
          <Select showSearch optionFilterProp="label" options={devices.filter((row) => row.device_type !== 'scanner' && row.status !== 'decommissioned').map((row) => ({
            value: row.id, label: `${row.manufacturer} ${row.model} — ${row.inventory_number || `ID ${row.id}`} / ${row.department?.name || 'Без отдела'}`,
          }))} />
        </Form.Item>
        <Form.Item name="slot" label="Место установки / цвет" rules={[{ required: true, whitespace: true }]} extra="Для монохромного принтера — «Основной», для цветного укажите цвет.">
          <Input maxLength={100} />
        </Form.Item>
        <Alert style={{ marginBottom: 16 }} type="info" showIcon message={outgoing
          ? `Будет снят ${outgoing.inventory_number} (${outgoing.name}) и отмечен как пустой у текущего получателя.`
          : 'На выбранном месте картридж ещё не зарегистрирован.'} />
        <Form.Item name="item_id" label="Устанавливаемый картридж" rules={[{ required: true }]}>
          <Select showSearch optionFilterProp="label" options={items.filter((row) => row.state === 'ready').map((row) => ({ value: row.item_id, label: `${row.inventory_number} — ${row.name} / ${row.location}` }))} />
        </Form.Item>
      </> : <>
        <Form.Item name="item_ids" label="Картриджи" rules={[{ required: true, type: 'array', min: 1 }]}>
          <Select mode="multiple" showSearch optionFilterProp="label" options={items.filter((row) => actionAllowed(mode, row)).map((row) => ({ value: row.item_id, label: `${row.inventory_number} — ${row.name} / ${row.location}` }))} />
        </Form.Item>
        {mode === 'send_refill' && <Form.Item name="contractor" label="Подрядчик по заправке" rules={[{ required: true, whitespace: true }]}><Input maxLength={255} /></Form.Item>}
        {mode === 'return_refill' && <Form.Item name="result" label="Результат возврата" rules={[{ required: true }]}>
          <Select options={[{ value: 'ready', label: 'Заправлен, запасной' }, { value: 'defective', label: 'Возвращён неисправным' }]} />
        </Form.Item>}
        {mode === 'write_off' && <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={`Будут списаны выбранные картриджи (${selectedIds.length}). История сохранится; отмены списания нет.`} />}
      </>}
      {['transfer', 'return_refill', 'remove', 'install'].includes(mode) && <DestinationFields form={form} {...data} installing={mode === 'install'} />}
      <Form.Item name="date" label="Дата операции" rules={[{ required: true }]}><DatePicker format="DD.MM.YYYY" disabledDate={(value) => value && value.isAfter(dayjs(), 'day')} /></Form.Item>
      <Form.Item name="notes" label="Примечание"><Input.TextArea rows={2} maxLength={4000} /></Form.Item>
    </Form>
  </Modal>
}

export default function CartridgesPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [data, setData] = useState({ items: [], operations: [], branches: [], departments: [], employees: [], devices: [], warehouse: [] })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [state, setState] = useState()
  const [grouping, setGrouping] = useState('holder')
  const [mode, setMode] = useState(null)
  const [selected, setSelected] = useState([])
  const [initialIds, setInitialIds] = useState([])
  const deviceFilter = Number(params.get('device')) || undefined
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const responses = await Promise.all(['/cartridges', '/cartridges/operations', '/orgs/branches', '/orgs/departments', '/employees', '/devices', '/warehouse/items'].map((path) => api.get(path)))
      setData(Object.fromEntries(['items', 'operations', 'branches', 'departments', 'employees', 'devices', 'warehouse'].map((key, index) => [key, responses[index].data])))
    } catch (error) { failure(error) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!loading && params.get('install') === '1') {
      setInitialIds([]); setMode('install')
      navigate(`/cartridges${deviceFilter ? `?device=${deviceFilter}` : ''}`, { replace: true })
    }
  }, [loading, params, deviceFilter, navigate])
  const current = data.items.find((item) => item.item_id === Number(id))
  const items = useMemo(() => data.items.filter((item) => {
    if (id && item.item_id !== Number(id)) return false
    if (deviceFilter && item.device_id !== deviceFilter) return false
    if (state && item.state !== state) return false
    const text = search.trim().toLowerCase()
    return !text || [item.inventory_number, item.name, item.location, item.contractor, item.compatible_printers].some((value) => value?.toLowerCase().includes(text))
  }), [data.items, id, deviceFilter, state, search])
  const history = data.operations.filter((row) => (!id || row.item_id === Number(id)) && (!deviceFilter || row.device_id === deviceFilter))
  const start = (operation, itemId) => {
    const ids = itemId ? [itemId] : id ? [Number(id)] : selected
    setInitialIds(ids.filter((itemId) => {
      const item = data.items.find((row) => row.item_id === itemId)
      return item && actionAllowed(operation, item)
    }))
    setMode(operation)
  }
  const print = async (item) => {
    try { await printBarcodeLabel({ path: `/cartridges/${item.item_id}`, inventoryNumber: item.inventory_number, title: 'Картридж', subtitle: item.name }) }
    catch (error) { message.error(error.message) }
  }
  const columns = [
    { title: 'Номер наклейки', dataIndex: 'inventory_number', render: (value, row) => <Button type="link" onClick={() => navigate(`/cartridges/${row.item_id}`)}>{value}</Button> },
    { title: 'Модель', dataIndex: 'name' },
    { title: 'Состояние', dataIndex: 'state', render: (value, row) => <Space>
      <Tag color={STATE_COLORS[value]}>{CARTRIDGE_STATES[value]}</Tag>
      {value === 'ready' && <Button size="small" onClick={() => start('install', row.item_id)}>Установить</Button>}
    </Space> },
    { title: 'Местонахождение / получатель', dataIndex: 'location' },
    { title: 'Совместимые принтеры', dataIndex: 'compatible_printers' },
    { title: 'Последняя установка', dataIndex: 'last_installed_at', render: fmtDate },
    { title: 'Последнее снятие', dataIndex: 'last_removed_at', render: fmtDate },
    { title: 'Отправлен на заправку', dataIndex: 'last_refill_sent_at', render: fmtDate },
    { title: 'Возвращён', dataIndex: 'last_refill_returned_at', render: fmtDate },
    { title: 'Заправок', dataIndex: 'refill_count' },
    { title: '', key: 'actions', render: (_, row) => <Button onClick={() => print(row)}>Этикетка</Button> },
  ]
  const summaryColumns = [
    { title: 'Получатель / местонахождение', dataIndex: 'location' }, { title: 'Модель', dataIndex: 'name' },
    ...['ready', 'installed', 'empty', 'refilling', 'defective'].map((key) => ({ title: key === 'ready' ? 'Запасные' : CARTRIDGE_STATES[key], dataIndex: key })),
    { title: 'Всего', dataIndex: 'total' },
  ]
  if (loading && !data.items.length) return <Spin />
  if (id && !current) return <Alert type="warning" message="Картридж не найден" action={<Button onClick={() => navigate('/cartridges')}>К списку</Button>} />
  return <>
    <Space wrap style={{ marginBottom: 16 }}>
      {(id || deviceFilter) && <Button onClick={() => navigate('/cartridges')}>Все картриджи</Button>}
      <Typography.Title level={3} style={{ margin: 0 }}>{id ? `${current.inventory_number} — ${current.name}` : 'Картриджи'}</Typography.Title>
      {!id && <Button type="primary" onClick={() => { setInitialIds([]); setMode('create') }}>Добавить / разобрать остаток</Button>}
      <Button onClick={load} loading={loading}>Обновить</Button>
    </Space>
    {current && <Card style={{ marginBottom: 16 }}><Descriptions column={{ xs: 1, md: 2 }} items={[
      { key: 'state', label: 'Состояние', children: CARTRIDGE_STATES[current.state] },
      { key: 'location', label: 'Местонахождение', children: current.location },
      { key: 'compatible', label: 'Совместимые принтеры', children: current.compatible_printers || '—' },
      { key: 'refills', label: 'Успешных заправок', children: current.refill_count },
      { key: 'notes', label: 'Примечание', children: current.notes || '—' },
      { key: 'card', label: 'Карточка оборудования', children: <Button type="link" onClick={() => navigate(`/warehouse/items/${current.item_id}`)}>Данные и фотографии</Button> },
    ]} /></Card>}
    <Space wrap style={{ marginBottom: 16 }}>
      {['transfer', 'install', 'remove', 'send_refill', 'return_refill', 'defective', 'write_off'].map((operation) => <Button
        key={operation} danger={operation === 'write_off'} disabled={Boolean(id && !actionAllowed(operation, current))}
        onClick={() => start(operation)}>{CARTRIDGE_OPERATIONS[operation]}</Button>)}
    </Space>
    {!id && <Space wrap style={{ display: 'flex', marginBottom: 16 }}>
      <Input.Search allowClear placeholder="Номер, модель, сотрудник, отдел" value={search} onChange={(event) => setSearch(event.target.value)} style={{ width: 320 }} />
      <Select allowClear placeholder="Все состояния" value={state} onChange={setState} style={{ width: 220 }} options={Object.entries(CARTRIDGE_STATES).map(([value, label]) => ({ value, label }))} />
      {deviceFilter && <Tag>Установленные в выбранном принтере</Tag>}
    </Space>}
    <Tabs items={[
      { key: 'items', label: `Картриджи (${items.length})`, children: <Table rowKey="item_id" dataSource={items} columns={columns} loading={loading}
        rowSelection={id ? undefined : { selectedRowKeys: selected, onChange: setSelected, preserveSelectedRowKeys: false }} scroll={{ x: 'max-content' }} pagination={{ pageSize: 25, showSizeChanger: true }} /> },
      ...(!id ? [{ key: 'summary', label: 'Остатки по получателям', children: <>
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Запасные — только готовые к установке картриджи. Списанные в остатки не входят. В итогах отдела учитываются картриджи сотрудников и отправленные из отдела на заправку." />
        <Select value={grouping} onChange={setGrouping} style={{ width: 290, marginBottom: 12 }} options={[
          { value: 'holder', label: 'По получателям и подрядчикам' }, { value: 'department', label: 'Итого по отделам, включая сотрудников' },
        ]} />
        <Table rowKey="key" dataSource={cartridgeSummary(items, grouping)} columns={summaryColumns} scroll={{ x: 'max-content' }} />
      </> }] : []),
      { key: 'history', label: 'История операций', children: <Table rowKey="id" dataSource={history} columns={operationColumns} scroll={{ x: 'max-content' }} pagination={{ pageSize: 25, showSizeChanger: true }} /> },
    ]} />
    <CartridgeModal mode={mode} initialIds={initialIds} initialDevice={deviceFilter} data={data}
      onClose={() => setMode(null)} onSaved={() => { setMode(null); setSelected([]); load() }} />
  </>
}
