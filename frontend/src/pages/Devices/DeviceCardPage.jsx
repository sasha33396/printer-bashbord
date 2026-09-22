import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Button, Card, Descriptions, Tag, Table, Space, Modal, Form,
  Input, InputNumber, Select, DatePicker, Popconfirm, Typography,
  Tabs, Statistic, Row, Col, message, Spin,
} from 'antd'
import {
  ArrowLeftOutlined, PlusOutlined, EditOutlined, DeleteOutlined, CheckOutlined,
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

const REPAIR_STATUS_OPTIONS = [
  { value: 'in_progress', label: 'В ремонте' },
  { value: 'completed',   label: 'Завершен' },
  { value: 'impossible',  label: 'Ремонт не возможен' },
]
const REPAIR_STATUS_LABELS = Object.fromEntries(REPAIR_STATUS_OPTIONS.map(o => [o.value, o.label]))
const REPAIR_STATUS_COLORS = { in_progress: 'orange', completed: 'green', impossible: 'red' }

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

function RepairModal({ open, editing, deviceId, initialPageCounter, onClose, onSaved }) {
  const [form]   = Form.useForm()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (editing) {
      form.setFieldsValue({
        date:        dayjs(editing.date),
        repair_type: editing.repair_type,
        repair_status: editing.repair_status,
        description: editing.description,
        contractor:  editing.contractor,
        cost:        editing.cost,
        page_counter: editing.page_counter,
        notes:       editing.notes,
      })
    } else {
      form.resetFields()
      form.setFieldsValue({
        date: dayjs(),
        repair_status: 'in_progress',
        page_counter: initialPageCounter ?? undefined,
      })
    }
  }, [open, editing, initialPageCounter, form])

  const handleSave = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      const payload = { ...values, device_id: deviceId, date: values.date.format('YYYY-MM-DD') }
      if (editing) {
        const completing = editing.repair_status !== 'completed' && payload.repair_status === 'completed'
        const updatePayload = completing
          ? { ...payload, repair_status: editing.repair_status }
          : payload
        await api.put(`/repairs/${editing.id}`, updatePayload)
        if (completing) {
          const { data } = await api.post(`/repairs/${editing.id}/complete`)
          message.success(`Ремонт завершён. Разница счётчика: ${data.page_counter_delta} стр.`)
        } else {
          message.success('Ремонт обновлён')
        }
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
          <Col span={12}>
            <Form.Item name="repair_status" label="Состояние" rules={[{ required: true }]}>
              <Select options={REPAIR_STATUS_OPTIONS} />
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
            <Form.Item
              name="page_counter"
              label="Счётчик страниц"
              extra={!editing && initialPageCounter != null ? 'Получен с принтера при открытии формы' : undefined}
            >
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
  const [counterLoading, setCounterLoading] = useState(false)
  const [repairCounterLoading, setRepairCounterLoading] = useState(false)
  const [repairsLoading,     setRepairsLoading]     = useState(false)
  const [completingRepairId, setCompletingRepairId] = useState(null)
  const [consumablesLoading, setConsumablesLoading] = useState(false)

  const [repairModal,     setRepairModal]     = useState(false)
  const [consumableModal, setConsumableModal] = useState(false)
  const [editingRepair,     setEditingRepair]     = useState(null)
  const [editingConsumable, setEditingConsumable] = useState(null)
  const [newRepairCounter, setNewRepairCounter] = useState(null)

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

  const refreshCounter = async () => {
    setCounterLoading(true)
    try {
      const { data } = await api.post(`/devices/${id}/counter`)
      setDevice((current) => current?.id === data.id ? data : current)
      message.success('Счётчик обновлён')
    } catch (err) {
      message.error(err.response?.data?.detail || 'Не удалось получить счётчик')
    } finally {
      setCounterLoading(false)
    }
  }

  const openCreateRepair = async () => {
    setEditingRepair(null)
    setNewRepairCounter(null)

    if (device.ip_address) {
      setRepairCounterLoading(true)
      try {
        const { data } = await api.post(`/devices/${id}/counter`)
        setDevice((current) => current?.id === data.id ? data : current)
        setNewRepairCounter(data.page_counter)
      } catch (err) {
        const detail = err.response?.data?.detail || 'Не удалось получить счётчик'
        message.warning(`${detail} Значение можно указать вручную.`)
      } finally {
        setRepairCounterLoading(false)
      }
    }

    setRepairModal(true)
  }

  const handleDeleteRepair = async (repairId) => {
    try {
      await api.delete(`/repairs/${repairId}`)
      message.success('Запись удалена')
      loadRepairs()
    } catch { message.error('Ошибка удаления') }
  }

  const handleCompleteRepair = async (repairId) => {
    setCompletingRepairId(repairId)
    try {
      const { data } = await api.post(`/repairs/${repairId}/complete`)
      message.success(`Ремонт завершён. Разница счётчика: ${data.page_counter_delta} стр.`)
      loadRepairs()
      loadDevice()
    } catch (err) {
      const detail = err.response?.data?.detail
      message.error(typeof detail === 'string' ? detail : 'Не удалось завершить ремонт')
    } finally {
      setCompletingRepairId(null)
    }
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
    {
      title: 'Состояние', dataIndex: 'repair_status', key: 'repair_status', width: 155,
      render: (v) => <Tag color={REPAIR_STATUS_COLORS[v]}>{REPAIR_STATUS_LABELS[v] ?? v}</Tag>,
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
      title: 'Счётчик до', dataIndex: 'page_counter', key: 'page_counter', width: 110,
      align: 'right',
      render: (v) => v ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'Счётчик после', dataIndex: 'completion_page_counter', key: 'completion_page_counter', width: 125,
      align: 'right',
      render: (v) => v ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'Разница', dataIndex: 'page_counter_delta', key: 'page_counter_delta', width: 95,
      align: 'right',
      render: (v) => v ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: '', key: 'actions', width: 200, align: 'right', fixed: 'right',
      render: (_, r) => (
        <Space size={4}>
          {r.repair_status === 'in_progress' && (
            <Popconfirm
              title="Завершить ремонт?"
              description="Будет получен текущий счётчик и рассчитана разница."
              okText="Завершить"
              cancelText="Отмена"
              onConfirm={() => handleCompleteRepair(r.id)}
            >
              <Button
                icon={<CheckOutlined />}
                size="small"
                type="primary"
                loading={completingRepairId === r.id}
              >
                Завершить
              </Button>
            </Popconfirm>
          )}
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
              loading={repairCounterLoading}
              onClick={openCreateRepair}>
              Добавить ремонт
            </Button>
          </div>
          <Table rowKey="id" dataSource={repairs} columns={repairCols}
            loading={repairsLoading} size="small"
            scroll={{ x: 'max-content' }}
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
        <Space wrap size="large">
          <Statistic title="Общий счётчик (печать и копирование)" value={device.page_counter ?? '—'} />
          <Space direction="vertical">
            <Button onClick={refreshCounter} loading={counterLoading} disabled={!device.ip_address}>
              Обновить счётчик
            </Button>
            <Typography.Text type="secondary">
              {device.ip_address ? `Опрос ${device.ip_address}` : 'Укажите IP-адрес в настройках устройства'}
            </Typography.Text>
            <Typography.Text type="secondary">
              {device.counter_checked_at
                ? `Получен: ${dayjs(device.counter_checked_at).format('DD.MM.YYYY HH:mm:ss')}`
                : 'Счётчик ещё не получен'}
            </Typography.Text>
          </Space>
        </Space>
      </Card>
      <Card style={{ marginBottom: 20 }}>
        <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small">
          <Descriptions.Item label="Тип">
            {TYPE_LABELS[device.device_type] ?? device.device_type}
          </Descriptions.Item>
          <Descriptions.Item label="IP-адрес">
            {device.ip_address || <Typography.Text type="secondary">—</Typography.Text>}
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
        initialPageCounter={newRepairCounter}
        onClose={() => setRepairModal(false)}
        onSaved={() => { setRepairModal(false); loadRepairs(); loadDevice() }}
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
