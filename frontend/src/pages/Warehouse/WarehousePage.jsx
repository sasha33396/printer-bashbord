import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AutoComplete, Button, Card, Col, DatePicker, Empty, Form, Input, InputNumber,
  Modal, Popconfirm, Row, Select, Space, Table, Tag, Typography, message,
} from 'antd'
import {
  ArrowLeftOutlined, DeleteOutlined, EditOutlined, HistoryOutlined, MinusOutlined,
  PlusOutlined, QrcodeOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'
import api from '../../api/api'
import { printQrLabel } from '../../utils/qr'

const DEFAULT_CATEGORIES = ['Картриджи', 'Мыши', 'Клавиатуры', 'Мониторы', 'Компьютеры', 'Телефоны', 'Принтеры']
const ASSET_CATEGORIES = new Set(['Мониторы', 'Компьютеры', 'Телефоны'])
const PLACEMENTS = ['Склад/серверная', 'Ремонт/заправка', 'Рабочее место']
const CONDITIONS = ['На складе', 'Рабочий', 'В ремонте', 'Требует ремонта', 'Списан']

const DEVICE_TYPE_LABELS = {
  printer: 'Принтер', mfc: 'МФУ', plotter: 'Плоттер', scanner: 'Сканер',
}
const DEVICE_STATUS_LABELS = {
  active: 'Рабочий', repair: 'В ремонте', decommissioned: 'Списан',
}

const MOVEMENT_CONFIG = {
  receipt: { label: 'Поступление', color: 'green', sign: '+' },
  issue:   { label: 'Отправить / выдать', color: 'red', sign: '−' },
}

const apiErrorMessage = (err, fallback) => {
  const detail = err.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map((item) => item.msg).filter(Boolean).join('; ') || fallback
  }
  return fallback
}

function ItemModal({ open, editing, initialCategory, categories, branches, departments, onClose, onSaved }) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const selectedBranch = Form.useWatch('branch_id', form)
  const selectedCategory = Form.useWatch('category', form)
  const trackingType = Form.useWatch('tracking_type', form)
  const availableDepartments = departments.filter((item) => item.branch_id === selectedBranch)

  useEffect(() => {
    if (!open) return
    form.resetFields()
    if (editing) {
      form.setFieldsValue(editing)
    } else {
      form.setFieldsValue({
        unit: 'шт.', min_quantity: 0, initial_quantity: 0,
        tracking_type: 'quantity', placement: 'Склад/серверная', condition: 'На складе',
        category: initialCategory && initialCategory !== 'Принтеры' ? initialCategory : undefined,
      })
      if (ASSET_CATEGORIES.has(initialCategory)) form.setFieldValue('tracking_type', 'asset')
    }
  }, [open, editing, initialCategory, form])

  const handleSave = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      if (editing) {
        await api.put(`/warehouse/items/${editing.id}`, values)
        message.success('Позиция обновлена')
      } else {
        await api.post('/warehouse/items', values)
        message.success('Позиция добавлена на склад')
      }
      onSaved()
    } catch (err) {
      message.error(apiErrorMessage(err, 'Не удалось сохранить позицию'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={editing ? 'Редактировать позицию' : 'Новая позиция'}
      open={open}
      onOk={handleSave}
      onCancel={onClose}
      confirmLoading={saving}
      okText="Сохранить"
      cancelText="Отмена"
      width={820}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Row gutter={16}>
          <Col span={16}>
            <Form.Item name="name" label="Наименование" rules={[{ required: true, message: 'Введите наименование' }]}>
              <Input placeholder="Например: Картридж Kyocera TK-1170" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="sku" label="Артикул">
              <Input placeholder="TK-1170" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="category" label="Категория" rules={[{ required: true, message: 'Укажите категорию' }]}>
              <AutoComplete
                options={[...new Set([...DEFAULT_CATEGORIES.filter((value) => value !== 'Принтеры'), ...categories])]
                  .map((value) => ({ value }))}
                placeholder="Картриджи, компьютеры…"
                filterOption={(input, option) => option.value.toLowerCase().includes(input.toLowerCase())}
                onChange={(value) => {
                  if (!editing) form.setFieldValue('tracking_type', ASSET_CATEGORIES.has(value) ? 'asset' : 'quantity')
                }}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="branch_id" label="Филиал / склад" rules={[{ required: true, message: 'Выберите филиал' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={branches.map((item) => ({ value: item.id, label: item.name }))}
                placeholder="Выберите филиал"
                onChange={() => form.setFieldValue('department_id', null)}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="tracking_type" label="Способ учёта" rules={[{ required: true }]}>
              <Select disabled={!!editing} options={[
                { value: 'quantity', label: 'По количеству' },
                { value: 'asset', label: 'Поштучно, с инвентарным номером' },
              ]} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="placement" label="Местонахождение" rules={[{ required: true }]}>
              <Select options={PLACEMENTS.map((value) => ({ value, label: value }))} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="condition" label="Состояние" rules={[{ required: true }]}>
              <Select options={CONDITIONS.map((value) => ({ value, label: value }))} />
            </Form.Item>
          </Col>
          {trackingType === 'asset' && <>
            <Col span={12}>
              <Form.Item name="inventory_number" label="Инвентарный №" rules={[{ required: true, message: 'Укажите инвентарный номер' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="serial_number" label="Серийный №"><Input /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="manufacturer" label="Производитель"><Input /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="model" label="Модель"><Input /></Form.Item>
            </Col>
          </>}
          {selectedCategory === 'Картриджи' && (
            <Col span={24}>
              <Form.Item name="compatible_printers" label="Для каких принтеров">
                <Input placeholder="Например: Kyocera ECOSYS M2040dn" />
              </Form.Item>
            </Col>
          )}
          {selectedCategory === 'Мониторы' && <>
            <Col span={12}><Form.Item name="monitor_diagonal" label="Диагональ, дюймы"><InputNumber min={1} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="color" label="Цвет"><Input /></Form.Item></Col>
          </>}
          {selectedCategory === 'Компьютеры' && <>
            <Col span={8}><Form.Item name="ram_gb" label="ОЗУ, ГБ"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={16}><Form.Item name="processor" label="Процессор"><Input /></Form.Item></Col>
            <Col span={24}><Form.Item name="graphics" label="Видеокарта"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="storage_type" label="Накопитель"><Select allowClear options={['SSD', 'HDD', 'HDD/SSD'].map((value) => ({ value }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="storage_capacity_gb" label="Объём, ГБ"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          </>}
          <Col span={12}>
            <Form.Item name="department_id" label="Отдел">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                disabled={!selectedBranch}
                options={availableDepartments.map((item) => ({ value: item.id, label: item.name }))}
                placeholder="Выберите отдел"
              />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="unit" label="Единица" rules={[{ required: true }]}>
              <Input placeholder="шт." />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="min_quantity" label="Мин. остаток" rules={[{ required: true }]}>
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          {!editing && trackingType !== 'asset' && (
            <Col span={12}>
              <Form.Item name="initial_quantity" label="Начальный остаток" rules={[{ required: true }]}>
                <InputNumber min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          )}
          <Col span={24}>
            <Form.Item name="notes" label="Примечание">
              <Input.TextArea rows={2} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  )
}

function MovementModal({ open, item, movementType, onClose, onSaved }) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const config = MOVEMENT_CONFIG[movementType]

  useEffect(() => {
    if (!open) return
    form.resetFields()
    form.setFieldsValue({ date: dayjs(), quantity: 1 })
  }, [open, movementType, form])

  const handleSave = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      await api.post(`/warehouse/items/${item.id}/movements`, {
        ...values,
        movement_type: movementType,
        date: values.date.format('YYYY-MM-DD'),
      })
      message.success(movementType === 'receipt' ? 'Поступление сохранено' : 'Выдача сохранена')
      onSaved()
    } catch (err) {
      message.error(apiErrorMessage(err, 'Не удалось сохранить операцию'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`${config?.label}: ${item?.name ?? ''}`}
      open={open}
      onOk={handleSave}
      onCancel={onClose}
      confirmLoading={saving}
      okText="Сохранить"
      cancelText="Отмена"
      destroyOnClose
    >
      <Typography.Text type="secondary">
        Текущий остаток: {item?.current_quantity ?? 0} {item?.unit}
      </Typography.Text>
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="date" label="Дата" rules={[{ required: true }]}>
              <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="quantity" label={`Количество (${item?.unit ?? 'шт.'})`} rules={[{ required: true }]}>
              <InputNumber min={1} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item name="notes" label={movementType === 'issue' ? 'Кому / назначение' : 'Примечание'}>
              <Input.TextArea rows={2} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  )
}

function HistoryModal({ item, open, onClose, onChanged }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!item) return
    setLoading(true)
    try {
      const response = await api.get(`/warehouse/items/${item.id}/movements`)
      setData(response.data)
    } catch (err) {
      message.error(apiErrorMessage(err, 'Не удалось загрузить историю'))
    } finally {
      setLoading(false)
    }
  }, [item])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const remove = async (movementId) => {
    try {
      await api.delete(`/warehouse/movements/${movementId}`)
      message.success('Операция удалена')
      load()
      onChanged()
    } catch (err) {
      message.error(apiErrorMessage(err, 'Не удалось удалить операцию'))
    }
  }

  const columns = [
    { title: 'Дата', dataIndex: 'date', width: 115, render: (value) => dayjs(value).format('DD.MM.YYYY') },
    {
      title: 'Операция', dataIndex: 'movement_type', width: 130,
      render: (value) => <Tag color={MOVEMENT_CONFIG[value]?.color}>{MOVEMENT_CONFIG[value]?.label}</Tag>,
    },
    {
      title: 'Количество', key: 'quantity', width: 120, align: 'right',
      render: (_, row) => {
        const config = MOVEMENT_CONFIG[row.movement_type]
        return <Typography.Text type={row.movement_type === 'issue' ? 'danger' : 'success'}>
          {config?.sign}{row.quantity} {item?.unit}
        </Typography.Text>
      },
    },
    { title: 'Примечание', dataIndex: 'notes', render: (value) => value || '—' },
    {
      title: '', width: 45, align: 'right',
      render: (_, row) => (
        <Popconfirm title="Удалить операцию?" onConfirm={() => remove(row.id)} okText="Удалить" cancelText="Отмена">
          <Button icon={<DeleteOutlined />} size="small" danger />
        </Popconfirm>
      ),
    },
  ]

  return (
    <Modal
      title={`История: ${item?.name ?? ''}`}
      open={open}
      onCancel={onClose}
      footer={<Button onClick={onClose}>Закрыть</Button>}
      width={800}
      destroyOnClose
    >
      <Table
        rowKey="id"
        dataSource={data}
        columns={columns}
        loading={loading}
        size="small"
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
      />
    </Modal>
  )
}

export default function WarehousePage() {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [devices, setDevices] = useState([])
  const [repairs, setRepairs] = useState([])
  const [branches, setBranches] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState()
  const [branchId, setBranchId] = useState()
  const [departmentId, setDepartmentId] = useState()
  const [itemModal, setItemModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [movement, setMovement] = useState(null)
  const [historyItem, setHistoryItem] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [itemResponse, deviceResponse, repairResponse] = await Promise.all([
        api.get('/warehouse/items'), api.get('/devices'), api.get('/repairs'),
      ])
      setItems(itemResponse.data)
      setDevices(deviceResponse.data)
      setRepairs(repairResponse.data)
    } catch (err) {
      message.error(apiErrorMessage(err, 'Не удалось загрузить данные склада'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    Promise.all([api.get('/orgs/branches'), api.get('/orgs/departments')])
      .then(([branchResponse, departmentResponse]) => {
        setBranches(branchResponse.data)
        setDepartments(departmentResponse.data)
      })
      .catch((err) => message.error(apiErrorMessage(err, 'Не удалось загрузить филиалы и отделы')))
  }, [])

  const categories = useMemo(() => [...new Set([
    ...DEFAULT_CATEGORIES,
    ...items.map((item) => item.category),
  ])], [items])

  const itemsAtLocation = useMemo(() => items.filter((item) => {
    if (branchId && item.branch_id !== branchId) return false
    if (departmentId && item.department_id !== departmentId) return false
    return true
  }), [items, branchId, departmentId])

  const devicesAtLocation = useMemo(() => devices.filter((device) => {
    if (branchId && device.department?.branch?.id !== branchId) return false
    if (departmentId && device.department_id !== departmentId) return false
    return true
  }), [devices, branchId, departmentId])

  const summary = useMemo(() => categories.map((name) => ({
    category: name,
    count: name === 'Принтеры'
      ? devicesAtLocation.length
      : itemsAtLocation
        .filter((item) => item.category === name)
        .reduce((total, item) => total + (item.tracking_type === 'asset' ? 1 : item.current_quantity), 0),
  })), [categories, devicesAtLocation, itemsAtLocation])

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    return itemsAtLocation.filter((item) => {
      if (category && item.category !== category) return false
      if (!query) return true
      return [
        item.name, item.sku, item.inventory_number, item.serial_number, item.manufacturer,
        item.model, item.category, item.branch?.name, item.department?.name, item.placement,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query))
    })
  }, [itemsAtLocation, search, category])

  const filteredDevices = useMemo(() => {
    const query = search.trim().toLowerCase()
    return devicesAtLocation.filter((device) => !query || [
      device.inventory_number, device.serial_number, device.manufacturer, device.model,
      device.department?.branch?.name, device.department?.name, device.location,
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query)))
  }, [devicesAtLocation, search])

  const lastRepair = useMemo(() => {
    const result = {}
    repairs.forEach((repair) => {
      if (!result[repair.device_id] || repair.date > result[repair.device_id]) result[repair.device_id] = repair.date
    })
    return result
  }, [repairs])

  const filterDepartments = branchId
    ? departments.filter((item) => item.branch_id === branchId)
    : departments

  const removeItem = async (id) => {
    try {
      await api.delete(`/warehouse/items/${id}`)
      message.success('Позиция удалена')
      load()
    } catch (err) {
      message.error(apiErrorMessage(err, 'Не удалось удалить позицию'))
    }
  }

  const printItem = async (item) => {
    try {
      await printQrLabel({
        path: `/warehouse/items/${item.id}`,
        inventoryNumber: item.inventory_number || item.sku,
        title: item.branch?.name || 'Склад',
        subtitle: [item.manufacturer, item.model || item.name].filter(Boolean).join(' '),
      })
    } catch (error) {
      message.error(error.message || 'Не удалось сформировать этикетку')
    }
  }

  const printDevice = async (device) => {
    try {
      await printQrLabel({
        path: `/devices/${device.id}`,
        inventoryNumber: device.inventory_number,
        title: device.department?.branch?.name || 'Устройство',
        subtitle: `${device.manufacturer} ${device.model}`,
      })
    } catch (error) {
      message.error(error.message || 'Не удалось сформировать этикетку')
    }
  }

  const locationColumn = {
    title: 'Местонахождение', key: 'placement', width: 175,
    render: (_, row) => row.placement || 'Склад/серверная',
  }
  const numberColumn = {
    title: '№', key: 'number', width: 110,
    render: (_, row) => row.inventory_number || row.sku || row.id,
  }
  const notesColumn = { title: 'Примечание', dataIndex: 'notes', ellipsis: true, render: (value) => value || '—' }
  const stateColumn = {
    title: 'Состояние', dataIndex: 'condition', width: 130,
    render: (value) => <Tag color={value === 'Рабочий' || value === 'На складе' ? 'green' : value === 'Списан' ? 'red' : 'orange'}>{value}</Tag>,
  }
  const itemActions = {
    title: '', key: 'actions', width: 280, fixed: 'right', align: 'right',
    render: (_, row) => (
      <Space size={4}>
        {row.tracking_type === 'asset' && (
          <Button size="small" type="primary" onClick={() => navigate(`/warehouse/items/${row.id}`)}>Открыть</Button>
        )}
        {row.tracking_type === 'quantity' && <>
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setMovement({ item: row, type: 'receipt' })}>Приход</Button>
          <Button size="small" icon={<MinusOutlined />} disabled={row.current_quantity <= 0} onClick={() => setMovement({ item: row, type: 'issue' })}>Отправить</Button>
        </>}
        <Button size="small" icon={<QrcodeOutlined />} title="Распечатать QR" onClick={() => printItem(row)} />
        <Button size="small" icon={<HistoryOutlined />} title="История" onClick={() => setHistoryItem(row)} />
        <Button size="small" icon={<EditOutlined />} title="Редактировать" onClick={() => { setEditing(row); setItemModal(true) }} />
        <Popconfirm title="Удалить позицию?" onConfirm={() => removeItem(row.id)} okText="Удалить" cancelText="Отмена">
          <Button size="small" icon={<DeleteOutlined />} danger />
        </Popconfirm>
      </Space>
    ),
  }

  const genericColumns = [
    locationColumn, numberColumn,
    { title: 'Наименование', dataIndex: 'name', ellipsis: true, render: (text, row) => <Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/warehouse/items/${row.id}`)}>{text}</Button> },
    { title: 'Артикул', dataIndex: 'sku', width: 120, render: (value) => value || '—' },
    {
      title: 'Количество', key: 'quantity', width: 125, align: 'right',
      render: (_, row) => <Tag color={row.current_quantity <= row.min_quantity ? 'red' : 'green'}>{row.current_quantity} {row.unit}</Tag>,
    },
    stateColumn, notesColumn, itemActions,
  ]
  const cartridgeColumns = [
    locationColumn, numberColumn,
    { title: 'Модель', key: 'model', render: (_, row) => row.model || row.name },
    { title: 'Для принтеров', dataIndex: 'compatible_printers', render: (value) => value || '—' },
    { title: 'Кол-во', dataIndex: 'current_quantity', width: 90, align: 'right' },
    itemActions,
  ]
  const monitorColumns = [
    locationColumn, numberColumn,
    { title: 'Модель', key: 'model', render: (_, row) => row.model || row.name },
    { title: 'Диагональ', dataIndex: 'monitor_diagonal', width: 100, render: (value) => value ? `${value}″` : '—' },
    { title: 'Цвет', dataIndex: 'color', width: 100, render: (value) => value || '—' },
    { title: 'S/N', dataIndex: 'serial_number', width: 140, render: (value) => value || '—' },
    stateColumn, notesColumn, itemActions,
  ]
  const computerColumns = [
    locationColumn, numberColumn,
    { title: 'S/N', dataIndex: 'serial_number', width: 130, render: (value) => value || '—' },
    { title: 'Модель', key: 'model', render: (_, row) => row.model || row.name },
    { title: 'ОЗУ', dataIndex: 'ram_gb', width: 75, render: (value) => value != null ? `${value} ГБ` : '—' },
    { title: 'ЦП', dataIndex: 'processor', width: 160, render: (value) => value || '—' },
    { title: 'ГПУ', dataIndex: 'graphics', width: 170, render: (value) => value || '—' },
    { title: 'Накопитель', dataIndex: 'storage_type', width: 105, render: (value) => value || '—' },
    { title: 'Объём', dataIndex: 'storage_capacity_gb', width: 90, render: (value) => value != null ? `${value} ГБ` : '—' },
    stateColumn, notesColumn, itemActions,
  ]
  const printerColumns = [
    {
      title: 'Местонахождение', key: 'location', width: 190,
      render: (_, row) => [row.department?.name, row.location].filter(Boolean).join(' / ') || '—',
    },
    { title: 'Инв. №', dataIndex: 'inventory_number', width: 120 },
    { title: 'S/N', dataIndex: 'serial_number', width: 130, render: (value) => value || '—' },
    { title: 'Модель', key: 'model', render: (_, row) => `${row.manufacturer} ${row.model}` },
    { title: 'Тип принтера', dataIndex: 'device_type', width: 125, render: (value) => DEVICE_TYPE_LABELS[value] || value },
    { title: 'Счётчик', dataIndex: 'page_counter', width: 100, align: 'right', render: (value) => value ?? '—' },
    { title: 'Последний ремонт', key: 'last_repair', width: 135, render: (_, row) => lastRepair[row.id] ? dayjs(lastRepair[row.id]).format('DD.MM.YYYY') : '—' },
    { title: 'Состояние', dataIndex: 'status', width: 115, render: (value) => <Tag>{DEVICE_STATUS_LABELS[value] || value}</Tag> },
    { title: 'Примечание', dataIndex: 'notes', ellipsis: true, render: (value) => value || '—' },
    {
      title: '', width: 120, fixed: 'right', align: 'right',
      render: (_, row) => <Space size={4}>
        <Button size="small" icon={<QrcodeOutlined />} title="Распечатать QR" onClick={() => printDevice(row)} />
        <Button size="small" type="primary" onClick={() => navigate(`/devices/${row.id}`)}>Открыть</Button>
      </Space>,
    },
  ]

  const selectedColumns = category === 'Картриджи' ? cartridgeColumns
    : category === 'Мониторы' ? monitorColumns
      : category === 'Компьютеры' ? computerColumns
        : genericColumns

  return (
    <>
      <div className="page-toolbar" style={{ marginBottom: 18 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>Склад и оборудование</Typography.Title>
        <Input.Search
          placeholder="Инвентарный №, модель, S/N"
          allowClear value={search} onChange={(event) => setSearch(event.target.value)} style={{ width: 270 }}
        />
        <Select
          placeholder="Все филиалы" allowClear showSearch optionFilterProp="label" value={branchId}
          onChange={(value) => { setBranchId(value); setDepartmentId(undefined) }}
          options={branches.map((item) => ({ value: item.id, label: item.name }))} style={{ width: 190 }}
        />
        <Select
          placeholder="Все отделы" allowClear showSearch optionFilterProp="label" value={departmentId}
          onChange={setDepartmentId} options={filterDepartments.map((item) => ({ value: item.id, label: item.name }))}
          style={{ width: 190 }}
        />
        <div className="toolbar-actions">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); setItemModal(true) }}>
            Добавить позицию
          </Button>
        </div>
      </div>

      <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
        {summary.map((row) => (
          <Col xs={12} sm={8} lg={4} key={row.category}>
            <Card
              hoverable
              size="small"
              onClick={() => setCategory(row.category)}
              style={{ borderColor: category === row.category ? '#1677ff' : undefined }}
            >
              <Typography.Text type="secondary">{row.category}</Typography.Text>
              <Typography.Title level={3} style={{ margin: '4px 0 0' }}>{row.count}</Typography.Title>
            </Card>
          </Col>
        ))}
      </Row>

      {!category ? (
        <Card title="Общий вид">
          <Table
            rowKey="category" loading={loading} pagination={false} size="small" dataSource={summary}
            columns={[
              { title: '№', width: 70, render: (_, __, index) => index + 1 },
              { title: 'Категория', dataIndex: 'category' },
              { title: 'Количество', dataIndex: 'count', width: 140, align: 'right' },
            ]}
            onRow={(row) => ({ onClick: () => setCategory(row.category), style: { cursor: 'pointer' } })}
          />
        </Card>
      ) : (
        <Card
          title={<Space><Button size="small" icon={<ArrowLeftOutlined />} onClick={() => setCategory(undefined)}>Общий вид</Button><span>{category}</span></Space>}
          extra={category !== 'Принтеры' && <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); setItemModal(true) }}>Добавить</Button>}
        >
          {(category === 'Принтеры' ? filteredDevices : filteredItems).length === 0 && !loading ? <Empty description="Нет записей" /> : (
            <Table
              rowKey="id"
              dataSource={category === 'Принтеры' ? filteredDevices : filteredItems}
              columns={category === 'Принтеры' ? printerColumns : selectedColumns}
              loading={loading}
              size="small"
              scroll={{ x: 'max-content' }}
              pagination={{ pageSize: 25, showSizeChanger: true, showTotal: (total) => `Позиций: ${total}` }}
            />
          )}
        </Card>
      )}

      <ItemModal
        open={itemModal} editing={editing} initialCategory={category}
        categories={categories.filter((value) => value !== 'Принтеры')}
        branches={branches} departments={departments}
        onClose={() => setItemModal(false)} onSaved={() => { setItemModal(false); load() }}
      />
      <MovementModal
        open={!!movement} item={movement?.item} movementType={movement?.type}
        onClose={() => setMovement(null)} onSaved={() => { setMovement(null); load() }}
      />
      <HistoryModal
        open={!!historyItem} item={historyItem}
        onClose={() => setHistoryItem(null)} onChanged={load}
      />
    </>
  )
}
