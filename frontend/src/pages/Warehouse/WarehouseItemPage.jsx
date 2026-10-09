import Table from '../../components/FilterableTable'
import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Button, DatePicker, Form, Input, Modal, Select, Space, Spin, Tag, Typography, message,
} from 'antd'
import {
  ArrowLeftOutlined, EditOutlined, HistoryOutlined, PrinterOutlined, RetweetOutlined, UndoOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import api from '../../api/api'
import { printBarcodeLabel } from '../../utils/barcode'
import EquipmentPhotos from '../../components/EquipmentPhotos'
import WarehouseItemModal from '../../components/WarehouseItemModal'
import { equipmentLocation } from '../../utils/equipmentLocation'

const CATEGORY_LABELS = {
  'Компьютеры': 'Компьютер', 'Ноутбуки': 'Ноутбук', 'Мониторы': 'Монитор', 'Картриджи': 'Картридж',
  'Мыши': 'Мышь', 'Клавиатуры': 'Клавиатура', 'Телефоны': 'Телефон',
}

const EVENT_LABELS = {
  created: 'Добавлено', imported: 'Импортировано', existing_record: 'Перенесено в журнал',
  updated: 'Изменено', archived: 'Архивировано', restored: 'Восстановлено',
  assigned_to_workplace: 'Установлено', returned_to_stock: 'Возвращено на склад',
  transferred: 'Передано', responsible_changed: 'Сменился ответственный',
  workplace_updated: 'Рабочее место изменено', stock_received: 'Поступление',
  stock_issued: 'Выдача', stock_movement_deleted: 'Операция удалена',
}

const fmtDate = (value) => value ? dayjs(value).format('DD.MM.YYYY') : '—'
const apiError = (error, fallback) => error.response?.data?.detail || fallback

function DetailField({ label, value, wide = false }) {
  const missing = value === null || value === undefined || value === ''
  return <div className={`inventory-detail-field${wide ? ' inventory-detail-field-wide' : ''}`}>
    <div className="inventory-detail-label">{label}</div>
    <div className={missing ? 'inventory-detail-value inventory-detail-empty' : 'inventory-detail-value'}>
      {missing ? '—' : value}
    </div>
  </div>
}

function TransferModal({ open, item, workplaces, onClose, onSaved }) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    form.resetFields()
    form.setFieldsValue({ transfer_date: dayjs() })
  }, [open, form])

  const save = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      await api.post(`/workplaces/items/${item.id}/transfer`, {
        ...values,
        transfer_date: values.transfer_date.format('YYYY-MM-DD'),
      })
      message.success(item.workplace ? 'Оборудование передано' : 'Оборудование установлено на рабочее место')
      onSaved()
    } catch (error) {
      message.error(apiError(error, 'Не удалось передать оборудование'))
    } finally {
      setSaving(false)
    }
  }

  return <Modal
    title={item.workplace ? 'Передать оборудование' : 'Установить на рабочее место'}
    open={open} onCancel={onClose} onOk={save} confirmLoading={saving}
    okText="Сохранить" cancelText="Отмена" destroyOnClose
  >
    <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
      <Form.Item name="workplace_id" label="Рабочее место" rules={[{ required: true, message: 'Выберите рабочее место' }]}>
        <Select
          showSearch optionFilterProp="label" placeholder="Выберите рабочее место"
          options={workplaces
            .filter((place) => place.id !== item.workplace?.id && place.status !== 'inactive')
            .map((place) => ({
              value: place.id,
              label: [place.name, place.employee?.full_name, place.branch?.name].filter(Boolean).join(' · '),
            }))}
        />
      </Form.Item>
      <Form.Item name="transfer_date" label="Дата передачи" rules={[{ required: true }]}>
        <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item name="notes" label="Примечание"><Input.TextArea rows={3} /></Form.Item>
    </Form>
  </Modal>
}

export default function WarehouseItemPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [item, setItem] = useState(null)
  const [assignments, setAssignments] = useState([])
  const [events, setEvents] = useState([])
  const [workplaces, setWorkplaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [transferOpen, setTransferOpen] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [editing, setEditing] = useState(null)
  const [branches, setBranches] = useState([])
  const [departments, setDepartments] = useState([])
  const [openingEditor, setOpeningEditor] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const itemResponse = await api.get(`/warehouse/items/${id}`)
      setItem(itemResponse.data)
      if (itemResponse.data.tracking_type === 'asset') {
        const [assignmentResponse, historyResponse, workplaceResponse] = await Promise.all([
          api.get(`/workplaces/items/${id}/assignments`),
          api.get('/history', { params: { entity_type: 'warehouse_item', entity_id: id, page_size: 8 } }),
          api.get('/workplaces'),
        ])
        setAssignments(assignmentResponse.data)
        setEvents(historyResponse.data.items)
        setWorkplaces(workplaceResponse.data)
      }
    } catch (error) {
      message.error(apiError(error, 'Оборудование не найдено'))
      navigate('/warehouse', { replace: true })
    } finally {
      setLoading(false)
    }
  }, [id, navigate])

  useEffect(() => { load() }, [load])

  const openEditor = async () => {
    setOpeningEditor(true)
    try {
      const [card, branchResponse, departmentResponse] = await Promise.all([
        api.get(`/warehouse/items/${id}`), api.get('/orgs/branches'), api.get('/orgs/departments'),
      ])
      if (card.data.is_archived) {
        message.warning('Сначала восстановите оборудование из архива')
        load()
        return
      }
      setBranches(branchResponse.data)
      setDepartments(departmentResponse.data)
      setEditing(card.data)
    } catch (error) {
      message.error(apiError(error, 'Не удалось открыть редактирование'))
    } finally {
      setOpeningEditor(false)
    }
  }

  const printLabel = async () => {
    try {
      await printBarcodeLabel({
        path: `/warehouse/items/${item.id}`,
        inventoryNumber: item.inventory_number || item.sku,
        title: item.branch?.name || 'Оборудование',
        subtitle: item.name,
      })
    } catch (error) {
      message.error(error.message || 'Не удалось сформировать этикетку')
    }
  }

  const restore = async () => {
    setRestoring(true)
    try {
      await api.post(`/warehouse/items/${item.id}/restore`)
      message.success('Оборудование восстановлено из архива')
      load()
    } catch (error) {
      message.error(apiError(error, 'Не удалось восстановить оборудование'))
    } finally {
      setRestoring(false)
    }
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
  if (!item) return null

  const categoryLabel = CATEGORY_LABELS[item.category] || item.category
  const isHealthy = item.condition === 'Рабочий' || item.condition === 'На складе'
  const statusClass = item.condition === 'Списан'
    ? 'inventory-status-danger'
    : isHealthy ? 'inventory-status-success' : 'inventory-status-warning'
  const storage = [item.storage_type, item.storage_capacity_gb != null ? `${item.storage_capacity_gb} ГБ` : null]
    .filter(Boolean).join(' · ')
  const characteristics = []
  if (['Компьютеры', 'Ноутбуки'].includes(item.category)) {
    characteristics.push(
      { label: 'Процессор', value: item.processor },
      { label: 'ОЗУ', value: item.ram_gb != null ? `${item.ram_gb} ГБ` : null },
      { label: 'Видеокарта', value: item.graphics },
      { label: 'Накопитель', value: storage },
    )
  }
  if (item.category === 'Мониторы') {
    characteristics.push(
      { label: 'Диагональ', value: item.monitor_diagonal != null ? `${item.monitor_diagonal}″` : null },
      { label: 'Цвет', value: item.color },
    )
  }
  if (item.compatible_printers) characteristics.push({ label: 'Для принтеров', value: item.compatible_printers, wide: true })
  if (item.notes) characteristics.push({ label: 'Примечание', value: item.notes, wide: true })

  const assignmentColumns = [
    { title: 'Рабочее место', dataIndex: 'workplace_name', render: (value) => value || '—' },
    { title: 'Сотрудник', dataIndex: 'employee_name', render: (value) => value || 'Не назначен' },
    { title: 'Филиал / отдел', key: 'org', render: (_, row) => [row.branch_name, row.department_name].filter(Boolean).join(' / ') || '—' },
    { title: 'Установлено', dataIndex: 'assigned_at', width: 120, render: fmtDate },
    { title: 'Снято', dataIndex: 'ended_at', width: 120, render: fmtDate },
    { title: 'Примечание', dataIndex: 'notes', render: (value) => value || '—' },
  ]
  const eventColumns = [
    { title: 'Дата', dataIndex: 'occurred_at', width: 145, render: (value) => dayjs(value).format('DD.MM.YYYY HH:mm') },
    { title: 'Событие', key: 'event', render: (_, event) => <><strong>{event.title}</strong><div className="history-event-type">{EVENT_LABELS[event.event_type] || event.event_type}</div></> },
    { title: 'Перемещение', key: 'move', render: (_, event) => event.from_value || event.to_value ? `${event.from_value || '—'} → ${event.to_value || '—'}` : event.workplace_name || '—' },
    { title: 'Сотрудник', dataIndex: 'employee_name', render: (value) => value || '—' },
    { title: 'Пользователь', dataIndex: 'actor', render: (value) => value || '—' },
  ]

  return <div className="inventory-detail-page">
    <Button className="inventory-detail-back" type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/warehouse')}>
      Оборудование
    </Button>

    {item.is_archived && <Alert
      type="warning" showIcon style={{ marginBottom: 14 }}
      message="Оборудование находится в архиве"
      action={<Button size="small" icon={<UndoOutlined />} loading={restoring} onClick={restore}>Восстановить</Button>}
    />}

    <section className="inventory-detail-card">
      <header className="inventory-detail-header">
        <div className="inventory-detail-heading">
          <div className="inventory-detail-title-row">
            <h1>{item.name}</h1>
            <span className="inventory-category-badge">{categoryLabel}</span>
            {item.is_archived && <Tag color="default">Архив</Tag>}
          </div>
          <div className="inventory-detail-summary">
            <span className={`inventory-status ${statusClass}`}><span className="inventory-status-dot" />{item.condition || '—'}</span>
            <span className={!item.inventory_number ? 'inventory-detail-empty' : undefined}>
              <span className="inventory-summary-label">Инв. №</span> {item.inventory_number || '—'}
            </span>
            <span><span className="inventory-summary-label">Остаток</span> {item.current_quantity} {item.unit}</span>
          </div>
        </div>
        <Space wrap>
          {!item.is_archived && <Button icon={<EditOutlined />} loading={openingEditor} onClick={openEditor}>Редактировать</Button>}
          {item.tracking_type === 'asset' && !item.is_archived && <Button icon={<RetweetOutlined />} onClick={() => setTransferOpen(true)}>
            {item.workplace ? 'Передать' : 'Установить'}
          </Button>}
          <Button type="primary" icon={<PrinterOutlined />} onClick={printLabel}>Распечатать штрихкод</Button>
        </Space>
      </header>

      <div className="inventory-detail-divider" />
      <div className="inventory-detail-grid">
        <DetailField label="Филиал" value={item.branch?.name} />
        <DetailField label="Отдел" value={item.department?.name} />
        <DetailField label="Местонахождение" value={equipmentLocation(item)} />
        <DetailField label="Способ учёта" value={item.tracking_type === 'asset' ? 'Поштучный' : 'По количеству'} />
        <DetailField label="Рабочее место" value={item.workplace && <Button className="inventory-workplace-link" type="link" onClick={() => navigate(`/workplaces/${item.workplace.id}`)}>{item.workplace.name}</Button>} />
        <DetailField label="Ответственный" value={item.responsible_person} />
        <DetailField label="Производитель" value={item.manufacturer} />
        <DetailField label="Модель" value={item.model} />
        {['Компьютеры', 'Ноутбуки', 'Телефоны'].includes(item.category) && <>
          <DetailField label="IP-адрес" value={item.ip_address} />
        </>}
        {(item.tracking_type === 'asset' || ['Компьютеры', 'Ноутбуки', 'Телефоны'].includes(item.category)) && (
          <DetailField label="MAC-адрес" value={item.mac_address && <Typography.Text copyable={{ text: item.mac_address }}>{item.mac_address}</Typography.Text>} />
        )}
        <DetailField label="Серийный №" value={item.serial_number} />
        <DetailField label="Артикул" value={item.sku} />
      </div>

      {characteristics.length > 0 && <>
        <div className="inventory-detail-divider" />
        <div className="inventory-detail-grid inventory-characteristics-grid">
          {characteristics.map((field) => <DetailField key={field.label} {...field} />)}
        </div>
      </>}
    </section>

    {item.tracking_type === 'asset' && <>
      <section className="workplace-section"><EquipmentPhotos itemId={item.id} /></section>
      <section className="workplace-section">
        <div className="workplace-section-header"><div><h2>История закрепления</h2><p>Рабочие места и сотрудники за всё время</p></div></div>
        <Table rowKey="id" dataSource={assignments} columns={assignmentColumns} size="small" scroll={{ x: 'max-content' }} pagination={{ pageSize: 10, hideOnSinglePage: true }} />
      </section>
      <section className="workplace-section">
        <div className="workplace-section-header">
          <div><h2>История движений</h2><p>Последние значимые действия с оборудованием</p></div>
          <Button icon={<HistoryOutlined />} onClick={() => navigate(`/history?entity_type=warehouse_item&entity_id=${item.id}`)}>Вся история</Button>
        </div>
        <Table rowKey="id" dataSource={events} columns={eventColumns} size="small" scroll={{ x: 'max-content' }} pagination={false} />
      </section>
    </>}

    <WarehouseItemModal
      open={Boolean(editing)} editing={editing} categories={[item.category]}
      branches={branches} departments={departments}
      onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }}
    />
    <TransferModal
      open={transferOpen} item={item} workplaces={workplaces}
      onClose={() => setTransferOpen(false)} onSaved={() => { setTransferOpen(false); load() }}
    />
  </div>
}
