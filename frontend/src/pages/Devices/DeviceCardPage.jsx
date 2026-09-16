import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Button, Card, Descriptions, Tag, Table, Space, Modal, Form,
  Input, InputNumber, Select, DatePicker, Popconfirm, Typography,
  Tabs, Statistic, Row, Col, message, Spin,
} from 'antd'
import {
  ArrowLeftOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import api from '../../api/api'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPE_LABELS = {
  printer: 'Принтер',
  mfc:     'МФУ',
  plotter: 'Плоттер',
  scanner: 'Сканер',
}

const STATUS_CONFIG = {
  active:         { color: 'green',  label: 'Активен'   },
  repair:         { color: 'orange', label: 'В ремонте'  },
  decommissioned: { color: 'red',    label: 'Списан'     },
}

const REPAIR_TYPE_OPTIONS = [
  { value: 'planned',   label: 'Плановый'    },
  { value: 'unplanned', label: 'Внеплановый' },
  { value: 'warranty',  label: 'Гарантийный' },
]
const REPAIR_TYPE_LABELS = Object.fromEntries(REPAIR_TYPE_OPTIONS.map(o => [o.value, o.label]))
const REPAIR_TYPE_COLORS = { planned: 'blue', unplanned: 'orange', warranty: 'green' }

const ITEM_TYPE_OPTIONS = [
  { value: 'toner_black', label: 'Тонер чёрный'  },
  { value: 'toner_color', label: 'Тонер цветной' },
  { value: 'drum',        label: 'Фотобарабан'   },
  { value: 'fuser',       label: 'Термоузел'     },
  { value: 'other',       label: 'Прочее'        },
]
const ITEM_TYPE_LABELS = Object.fromEntries(ITEM_TYPE_OPTIONS.map(o => [o.value, o.label]))

const fmt     = (v) =>
  new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 }).format(v ?? 0)
const fmtDate = (v) => (v ? dayjs(v).format('DD.MM.YYYY') : '—')

// ---------------------------------------------------------------------------
// RepairModal
// ---------------------------------------------------------------------------

function RepairModal({ open, editing, deviceId, onClose, onSaved }) {
  const [form]   = Form.useForm()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (editing) {
      form.setFieldsValue({
        date:        dayjs(editing.date),
        repair_type: editing.repair_type,
        description: editing.description,
        contractor:  editing.contractor,
        cost:        editing.cost,
        page_counter: editing.page_counter,
        notes:       editing.notes,
      })
    } else {
      form.resetFields()
      form.setFieldValue('date', dayjs())
    }
  }, [open, editing, form])

  const handleSave = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      const payload = { ...values, device_id: deviceId, date: values.date.format('YYYY-MM-DD') }
      if (editing) {
        await api.put(`/repairs/${editing.id}`, payload)
        message.success('Ремонт обновлён')
      } else {
        await api.post('/repairs', payload)
        message.success('Ремонт добавлен')
      }
      onSaved()
    } catch (err) {
      message.error(err.response?.data?.detail || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={editing ? 'Редактировать ремонт' : 'Добавить ремонт'}
      open={open}
      onOk={handleSave}
      onCancel={onClose}
      confirmLoading={saving}
      okText="Сохранить"
      cancelText="Отмена"
      width={580}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="date" label="Дата" rules={[{ required: true, message: 'Укажите дату' }]}>
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="repair_type" label="Тип ремонта" rules={[{ required: true, message: 'Выберите тип' }]}>
              <Select options={REPAIR_TYPE_OPTIONS} placeholder="Выберите тип" />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item name="description" label="Описание" rules={[{ required: true, message: 'Введите описание' }]}>
              <Input.TextArea rows={2} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="contractor" label="Исполнитель">
              <Input placeholder="ФИО или организация" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="cost" label="Стоимость (₽)">
              <InputNumber style={{ width: '100%' }} min={0} precision={2} placeholder="0.00" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="page_counter" label="Счётчик страниц">
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
          </Col>
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

// ---------------------------------------------------------------------------
// ConsumableModal
// ---------------------------------------------------------------------------

function ConsumableModal({ open, editing, deviceId, onClose, onSaved }) {
  const [form]   = Form.useForm()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (editing) {
      form.setFieldsValue({
        date:         dayjs(editing.date),
        item_type:    editing.item_type,
        quantity:     editing.quantity,
        unit_cost:    editing.unit_cost,
        page_counter: editing.page_counter,
        notes:        editing.notes,
      })
    } else {
      form.resetFields()
      form.setFieldsValue({ date: dayjs(), quantity: 1, unit_cost: 0 })
    }
  }, [open, editing, form])

  const handleSave = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      const payload = { ...values, device_id: deviceId, date: values.date.format('YYYY-MM-DD') }
      if (editing) {
        await api.put(`/consumables/${editing.id}`, payload)
        message.success('Запись обновлена')
      } else {
        await api.post('/consumables', payload)
        message.success('Расходник добавлен')
      }
      onSaved()
    } catch (err) {
      message.error(err.response?.data?.detail || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={editing ? 'Редактировать расходник' : 'Добавить расходник'}
      open={open}
      onOk={handleSave}
      onCancel={onClose}
      confirmLoading={saving}
      okText="Сохранить"
      cancelText="Отмена"
      width={520}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="date" label="Дата" rules={[{ required: true, message: 'Укажите дату' }]}>
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="item_type" label="Тип расходника" rules={[{ required: true, message: 'Выберите тип' }]}>
              <Select options={ITEM_TYPE_OPTIONS} placeholder="Выберите тип" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="quantity" label="Количество" rules={[{ required: true }]}>
              <InputNumber style={{ width: '100%' }} min={1} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="unit_cost" label="Цена за ед. (₽)">
              <InputNumber style={{ width: '100%' }} min={0} precision={2} placeholder="0.00" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="page_counter" label="Счётчик страниц">
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
          </Col>
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

// ---------------------------------------------------------------------------
// DeviceCardPage
// ---------------------------------------------------------------------------

export default function DeviceCardPage() {
  const { id }    = useParams()
  const navigate  = useNavigate()

  const [device,   setDevice]   = useState(null)
  const [repairs,  setRepairs]  = useState([])
  const [consumables, setConsumables] = useState([])

  const [deviceLoading,      setDeviceLoading]      = useState(true)
  const [repairsLoading,     setRepairsLoading]     = useState(false)
  const [consumablesLoading, setConsumablesLoading] = useState(false)

  const [repairModal,     setRepairModal]     = useState(false)
  const [consumableModal, setConsumableModal] = useState(false)
  const [editingRepair,     setEditingRepair]     = useState(null)
  const [editingConsumable, setEditingConsumable] = useState(null)

  // ---- Loaders ----

  const loadDevice = useCallback(async () => {
    setDeviceLoading(true)
    try {
      const { data } = await api.get(`/devices/${id}`)
      setDevice(data)
    } catch {
      message.error('Устройство не найдено')
      navigate('/devices')
    } finally {
      setDeviceLoading(false)
    }
  }, [id, navigate])

  const loadRepairs = useCallback(async () => {
    setRepairsLoading(true)
    try {
      const { data } = await api.get('/repairs', { params: { device_id: id } })
      setRepairs(data)
    } catch {
      message.error('Не удалось загрузить историю ремонтов')
    } finally {
      setRepairsLoading(false)
    }
  }, [id])

  const loadConsumables = useCallback(async () => {
    setConsumablesLoading(true)
    try {
      const { data } = await api.get('/consumables', { params: { device_id: id } })
      setConsumables(data)
    } catch {
      message.error('Не удалось загрузить историю расходников')
    } finally {
      setConsumablesLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadDevice()
    loadRepairs()
    loadConsumables()
  }, [loadDevice, loadRepairs, loadConsumables])

  // ---- Handlers ----

  const handleDeleteRepair = async (repairId) => {
    try {
      await api.delete(`/repairs/${repairId}`)
      message.success('Запись удалена')
      loadRepairs()
    } catch { message.error('Ошибка удаления') }
  }

  const handleDeleteConsumable = async (logId) => {
    try {
      await api.delete(`/consumables/${logId}`)
      message.success('Запись удалена')
      loadConsumables()
    } catch { message.error('Ошибка удаления') }
  }

  // ---- Table columns ----

  const repairCols = [
    {
      title: 'Дата', dataIndex: 'date', key: 'date', width: 110,
      defaultSortOrder: 'descend',
      sorter: (a, b) => a.date.localeCompare(b.date),
      render: fmtDate,
    },
    {
      title: 'Тип', dataIndex: 'repair_type', key: 'repair_type', width: 130,
      render: (v) => <Tag color={REPAIR_TYPE_COLORS[v]}>{REPAIR_TYPE_LABELS[v] ?? v}</Tag>,
    },
    { title: 'Описание', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: 'Исполнитель', dataIndex: 'contractor', key: 'contractor', width: 160,
      render: (v) => v || <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'Стоимость', dataIndex: 'cost', key: 'cost', width: 130,
      align: 'right',
      sorter: (a, b) => (a.cost ?? 0) - (b.cost ?? 0),
      render: (v) => <Typography.Text strong>{fmt(v)}</Typography.Text>,
    },
    {
      title: 'Счётчик', dataIndex: 'page_counter', key: 'page_counter', width: 90,
      align: 'right',
      render: (v) => v ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: '', key: 'actions', width: 80, align: 'right',
      render: (_, r) => (
        <Space size={4}>
          <Button icon={<EditOutlined />} size="small"
            onClick={() => { setEditingRepair(r); setRepairModal(true) }} />
          <Popconfirm title="Удалить ремонт?" okText="Удалить" cancelText="Отмена"
            okButtonProps={{ danger: true }} onConfirm={() => handleDeleteRepair(r.id)}>
            <Button icon={<DeleteOutlined />} size="small" danger />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const consumableCols = [
    {
      title: 'Дата', dataIndex: 'date', key: 'date', width: 110,
      defaultSortOrder: 'descend',
      sorter: (a, b) => a.date.localeCompare(b.date),
      render: fmtDate,
    },
    {
      title: 'Тип расходника', dataIndex: 'item_type', key: 'item_type', width: 150,
      render: (v) => ITEM_TYPE_LABELS[v] ?? v,
    },
    { title: 'Кол-во', dataIndex: 'quantity', key: 'quantity', width: 80, align: 'center' },
    {
      title: 'Цена/ед.', dataIndex: 'unit_cost', key: 'unit_cost', width: 110,
      align: 'right', render: fmt,
    },
    {
      title: 'Итого', key: 'total', width: 120, align: 'right',
      render: (_, r) => (
        <Typography.Text strong>{fmt((r.unit_cost ?? 0) * (r.quantity ?? 0))}</Typography.Text>
      ),
    },
    {
      title: 'Счётчик', dataIndex: 'page_counter', key: 'page_counter', width: 90,
      align: 'right',
      render: (v) => v ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: '', key: 'actions', width: 80, align: 'right',
      render: (_, r) => (
        <Space size={4}>
          <Button icon={<EditOutlined />} size="small"
            onClick={() => { setEditingConsumable(r); setConsumableModal(true) }} />
          <Popconfirm title="Удалить запись?" okText="Удалить" cancelText="Отмена"
            okButtonProps={{ danger: true }} onConfirm={() => handleDeleteConsumable(r.id)}>
            <Button icon={<DeleteOutlined />} size="small" danger />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  // ---- Render: loading ----

  if (deviceLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    )
  }

  if (!device) return null

  const statusCfg      = STATUS_CONFIG[device.status] ?? { color: 'default', label: device.status }
  const totalRepairCost   = repairs.reduce((s, r) => s + (r.cost ?? 0), 0)
  const totalConsumableCost = consumables.reduce((s, c) => s + (c.unit_cost ?? 0) * (c.quantity ?? 0), 0)

  const tabItems = [
    {
      key: 'repairs',
      label: `Ремонты (${repairs.length})`,
      children: (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
            <Row gutter={32}>
              <Col>
                <Statistic title="Всего ремонтов" value={repairs.length} />
              </Col>
              <Col>
                <Statistic
                  title="Суммарные затраты"
                  value={fmt(totalRepairCost)}
                  valueStyle={{ color: totalRepairCost > 0 ? '#cf1322' : undefined }}
                />
              </Col>
            </Row>
            <Button type="primary" icon={<PlusOutlined />}
              onClick={() => { setEditingRepair(null); setRepairModal(true) }}>
              Добавить ремонт
            </Button>
          </div>
          <Table rowKey="id" dataSource={repairs} columns={repairCols}
            loading={repairsLoading} size="small"
            pagination={{ pageSize: 15, hideOnSinglePage: true }}
          />
        </>
      ),
    },
    {
      key: 'consumables',
      label: `Расходники (${consumables.length})`,
      children: (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
            <Row gutter={32}>
              <Col>
                <Statistic title="Всего записей" value={consumables.length} />
              </Col>
              <Col>
                <Statistic
                  title="Суммарные затраты"
                  value={fmt(totalConsumableCost)}
                  valueStyle={{ color: totalConsumableCost > 0 ? '#cf1322' : undefined }}
                />
              </Col>
            </Row>
            <Button type="primary" icon={<PlusOutlined />}
              onClick={() => { setEditingConsumable(null); setConsumableModal(true) }}>
              Добавить расходник
            </Button>
          </div>
          <Table rowKey="id" dataSource={consumables} columns={consumableCols}
            loading={consumablesLoading} size="small"
            pagination={{ pageSize: 15, hideOnSinglePage: true }}
          />
        </>
      ),
    },
  ]

  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/devices')}>
          Устройства
        </Button>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {device.inventory_number} — {device.manufacturer} {device.model}
        </Typography.Title>
        <Tag color={statusCfg.color}>{statusCfg.label}</Tag>
      </div>

      {/* Device info */}
      <Card style={{ marginBottom: 20 }}>
        <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small">
          <Descriptions.Item label="Тип">
            {TYPE_LABELS[device.device_type] ?? device.device_type}
          </Descriptions.Item>
          <Descriptions.Item label="Серийный №">
            {device.serial_number || <Typography.Text type="secondary">—</Typography.Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Статус">
            <Tag color={statusCfg.color}>{statusCfg.label}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Филиал">
            {device.department?.branch?.name || <Typography.Text type="secondary">—</Typography.Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Отдел">
            {device.department?.name || <Typography.Text type="secondary">—</Typography.Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Кабинет">
            {device.location || <Typography.Text type="secondary">—</Typography.Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Дата покупки">{fmtDate(device.purchase_date)}</Descriptions.Item>
          <Descriptions.Item label="Гарантия до">
            {device.warranty_until ? (
              <span style={{ color: dayjs().isAfter(dayjs(device.warranty_until)) ? '#ff4d4f' : undefined }}>
                {fmtDate(device.warranty_until)}
              </span>
            ) : <Typography.Text type="secondary">—</Typography.Text>}
          </Descriptions.Item>
          {device.notes && (
            <Descriptions.Item label="Примечание" span={3}>{device.notes}</Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      {/* Repairs + Consumables */}
      <Card>
        <Tabs items={tabItems} />
      </Card>

      {/* Modals */}
      <RepairModal
        open={repairModal}
        editing={editingRepair}
        deviceId={Number(id)}
        onClose={() => setRepairModal(false)}
        onSaved={() => { setRepairModal(false); loadRepairs() }}
      />
      <ConsumableModal
        open={consumableModal}
        editing={editingConsumable}
        deviceId={Number(id)}
        onClose={() => setConsumableModal(false)}
        onSaved={() => { setConsumableModal(false); loadConsumables() }}
      />
    </>
  )
}
