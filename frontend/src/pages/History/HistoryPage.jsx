import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, DatePicker, Input, Select, Space, Table, Tag, Typography, message } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import api from '../../api/api'

const CATEGORY = {
  equipment: { label: 'Оборудование', color: 'blue' },
  device: { label: 'Устройство', color: 'cyan' },
  workplace: { label: 'Рабочее место', color: 'purple' },
  repair: { label: 'Ремонт', color: 'orange' },
  stock: { label: 'Складская операция', color: 'green' },
}

const EVENT_TYPES = {
  created: 'Добавлено', imported: 'Импортировано', existing_record: 'Перенесено в журнал',
  updated: 'Изменено', archived: 'Архивировано', restored: 'Восстановлено', deleted: 'Удалено',
  assigned_to_workplace: 'Установлено', returned_to_stock: 'Возвращено на склад',
  transferred: 'Передано', responsible_changed: 'Сменился ответственный', workplace_updated: 'Рабочее место изменено',
  stock_received: 'Поступление', stock_issued: 'Выдача', stock_movement_deleted: 'Операция удалена',
  repair_created: 'Ремонт добавлен', repair_updated: 'Ремонт изменён', repair_completed: 'Ремонт завершён',
  repair_impossible: 'Ремонт невозможен', repair_deleted: 'Ремонт удалён',
  repair_invoice_attached: 'Счёт прикреплён', repair_invoice_removed: 'Счёт удалён',
}

function details(event) {
  const rows = Object.entries(event.changes || {})
  if (!event.details && rows.length === 0) return <Typography.Text type="secondary">Дополнительных данных нет</Typography.Text>
  return <Space direction="vertical" size={6} style={{ width: '100%' }}>
    {event.details && <Typography.Text>{event.details}</Typography.Text>}
    {rows.map(([field, values]) => (
      <div key={field} className="history-change-row">
        <strong>{field}:</strong>
        <span>{formatValue(values?.before)}</span>
        <span>→</span>
        <span>{formatValue(values?.after)}</span>
      </div>
    ))}
  </Space>
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

export default function HistoryPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const initial = useMemo(() => new URLSearchParams(location.search), [location.search])
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState()
  const [eventType, setEventType] = useState()
  const [branchName, setBranchName] = useState()
  const [employeeName, setEmployeeName] = useState()
  const [branches, setBranches] = useState([])
  const [employees, setEmployees] = useState([])
  const [period, setPeriod] = useState()
  const entityType = initial.get('entity_type') || undefined
  const entityId = initial.get('entity_id') ? Number(initial.get('entity_id')) : undefined

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/history', { params: {
        page, page_size: pageSize, search: search || undefined,
        category, event_type: eventType, entity_type: entityType, entity_id: entityId,
        branch_name: branchName, employee_name: employeeName,
        date_from: period?.[0]?.format('YYYY-MM-DD'),
        date_to: period?.[1]?.format('YYYY-MM-DD'),
      } })
      setItems(data.items)
      setTotal(data.total)
    } catch (error) {
      message.error(error.response?.data?.detail || 'Не удалось загрузить историю движений')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, search, category, eventType, branchName, employeeName, period, entityType, entityId])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    Promise.all([api.get('/orgs/branches'), api.get('/employees')])
      .then(([branchResponse, employeeResponse]) => {
        setBranches(branchResponse.data)
        setEmployees(employeeResponse.data)
      })
      .catch(() => {})
  }, [])

  const openEntity = (event) => {
    if (!event.entity_id) return
    if (event.entity_type === 'device') navigate(`/devices/${event.entity_id}`)
    if (event.entity_type === 'warehouse_item') navigate(`/warehouse/items/${event.entity_id}`)
  }

  const columns = [
    {
      title: 'Дата и время', dataIndex: 'occurred_at', width: 155,
      render: (value) => dayjs(value).format('DD.MM.YYYY HH:mm'),
    },
    {
      title: 'Категория', dataIndex: 'category', width: 135,
      render: (value) => <Tag color={CATEGORY[value]?.color}>{CATEGORY[value]?.label || value}</Tag>,
    },
    {
      title: 'Событие', key: 'event', minWidth: 210,
      render: (_, event) => <div><strong>{event.title}</strong><div className="history-event-type">{EVENT_TYPES[event.event_type] || event.event_type}</div></div>,
    },
    {
      title: 'Объект', key: 'entity', minWidth: 220,
      render: (_, event) => <Button type="link" style={{ padding: 0, height: 'auto', textAlign: 'left' }} onClick={() => openEntity(event)}>
        {[event.inventory_number, event.entity_name].filter(Boolean).join(' · ')}
      </Button>,
    },
    {
      title: 'Перемещение', key: 'direction', minWidth: 220,
      render: (_, event) => event.from_value || event.to_value
        ? `${event.from_value || '—'} → ${event.to_value || '—'}`
        : event.workplace_name || '—',
    },
    { title: 'Сотрудник', dataIndex: 'employee_name', minWidth: 170, render: (value) => value || '—' },
    { title: 'Пользователь', dataIndex: 'actor', width: 130, render: (value) => value || '—' },
  ]

  return <>
    <div className="page-toolbar history-toolbar">
      <Typography.Title level={3} style={{ margin: 0 }}>История движений</Typography.Title>
      <Input.Search
        placeholder="Инв. номер, наименование, сотрудник"
        allowClear
        onSearch={(value) => { setSearch(value); setPage(1) }}
        style={{ width: 300 }}
      />
      <Select
        placeholder="Все категории" allowClear value={category}
        onChange={(value) => { setCategory(value); setPage(1) }}
        options={Object.entries(CATEGORY).map(([value, item]) => ({ value, label: item.label }))}
        style={{ width: 180 }}
      />
      <Select
        placeholder="Все события" allowClear showSearch optionFilterProp="label" value={eventType}
        onChange={(value) => { setEventType(value); setPage(1) }}
        options={Object.entries(EVENT_TYPES).map(([value, label]) => ({ value, label }))}
        style={{ width: 210 }}
      />
      <Select
        placeholder="Все филиалы" allowClear showSearch optionFilterProp="label" value={branchName}
        onChange={(value) => { setBranchName(value); setPage(1) }}
        options={branches.map((item) => ({ value: item.name, label: item.name }))}
        style={{ width: 180 }}
      />
      <Select
        placeholder="Все сотрудники" allowClear showSearch optionFilterProp="label" value={employeeName}
        onChange={(value) => { setEmployeeName(value); setPage(1) }}
        options={employees.map((item) => ({ value: item.full_name, label: item.full_name }))}
        style={{ width: 210 }}
      />
      <DatePicker.RangePicker value={period} onChange={(value) => { setPeriod(value); setPage(1) }} format="DD.MM.YYYY" />
      {(entityType || entityId) && <Button onClick={() => navigate('/history')}>Показать всю историю</Button>}
    </div>
    <Table
      rowKey="id"
      dataSource={items}
      columns={columns}
      loading={loading}
      size="small"
      scroll={{ x: 'max-content' }}
      expandable={{ expandedRowRender: details, rowExpandable: (event) => Boolean(event.details || Object.keys(event.changes || {}).length) }}
      pagination={{
        current: page, pageSize, total, showSizeChanger: true,
        showTotal: (value) => `Событий: ${value}`,
        onChange: (nextPage, nextSize) => { setPage(nextSize !== pageSize ? 1 : nextPage); setPageSize(nextSize) },
      }}
    />
  </>
}
