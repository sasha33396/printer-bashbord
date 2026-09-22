import { useState, useEffect, useCallback } from 'react'
import {
  Row, Col, Card, Statistic, Table, Button, Select,
  DatePicker, Typography, Space, Tag, Divider, message,
} from 'antd'
import {
  ToolOutlined, FileExcelOutlined, SearchOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import api from '../../api/api'

const { RangePicker } = DatePicker

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmt = (v) =>
  new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 2,
  }).format(v ?? 0)

const fmtNum = (v, suffix = '') =>
  v == null ? '—' : `${new Intl.NumberFormat('ru-RU').format(v)}${suffix}`

// ---------------------------------------------------------------------------
// RepairTypeCard — repairs_by_type breakdown
// ---------------------------------------------------------------------------

const REPAIR_TYPES = [
  { key: 'planned',   label: 'Плановые',      color: 'blue'   },
  { key: 'unplanned', label: 'Внеплановые',   color: 'orange' },
  { key: 'warranty',  label: 'Гарантийные',   color: 'green'  },
]

function RepairTypeCard({ data, loading }) {
  const total = data ? data.planned + data.unplanned + data.warranty : 0

  return (
    <Card loading={loading} style={{ height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <ToolOutlined style={{ fontSize: 16, color: '#1677ff' }} />
        <Typography.Text type="secondary">Ремонты за период</Typography.Text>
      </div>
      <Typography.Title level={3} style={{ margin: 0, marginBottom: 12 }}>
        {total}
      </Typography.Title>
      <Space direction="vertical" style={{ width: '100%' }} size={6}>
        {REPAIR_TYPES.map(({ key, label, color }) => {
          const count = data?.[key] ?? 0
          const pct   = total > 0 ? Math.round((count / total) * 100) : 0
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Tag color={color} style={{ minWidth: 100, textAlign: 'center', margin: 0 }}>
                {label}
              </Tag>
              <div style={{
                flex: 1, height: 6, borderRadius: 3, background: '#f0f0f0', overflow: 'hidden',
              }}>
                <div style={{
                  width: `${pct}%`, height: '100%', borderRadius: 3,
                  background: color === 'blue' ? '#1677ff' : color === 'orange' ? '#fa8c16' : '#52c41a',
                  transition: 'width 0.4s',
                }} />
              </div>
              <Typography.Text style={{ minWidth: 48, textAlign: 'right' }}>
                {count} <Typography.Text type="secondary" style={{ fontSize: 11 }}>({pct}%)</Typography.Text>
              </Typography.Text>
            </div>
          )
        })}
      </Space>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Costs table columns
// ---------------------------------------------------------------------------

const sorter = (key) => (a, b) => (a[key] ?? 0) - (b[key] ?? 0)

const COLUMNS = [
  {
    title: 'Инв.№',
    dataIndex: 'inventory_number',
    key: 'inventory_number',
    width: 130,
  },
  {
    title: 'Модель',
    dataIndex: 'model',
    key: 'model',
  },
  {
    title: 'Филиал / Отдел',
    key: 'org',
    ellipsis: true,
    render: (_, r) => {
      if (!r.branch && !r.department) return <Typography.Text type="secondary">—</Typography.Text>
      return r.branch ? `${r.branch} / ${r.department}` : r.department
    },
  },
  {
    title: 'Затраты на ремонт',
    dataIndex: 'total_repair_cost',
    key: 'total_repair_cost',
    align: 'right',
    width: 160,
    sorter: sorter('total_repair_cost'),
    render: (v) => fmt(v),
  },
  {
    title: 'Ремонты',
    dataIndex: 'repair_count',
    key: 'repair_count',
    align: 'center',
    width: 90,
    sorter: sorter('repair_count'),
  },
  {
    title: 'Затраты расходники',
    dataIndex: 'total_consumable_cost',
    key: 'total_consumable_cost',
    align: 'right',
    width: 170,
    sorter: sorter('total_consumable_cost'),
    render: (v) => fmt(v),
  },
  {
    title: 'Итого',
    dataIndex: 'total_cost',
    key: 'total_cost',
    align: 'right',
    width: 130,
    sorter: sorter('total_cost'),
    defaultSortOrder: 'descend',
    render: (v) => <Typography.Text strong>{fmt(v)}</Typography.Text>,
  },
  {
    title: 'Цена отпечатка',
    dataIndex: 'cost_per_page',
    key: 'cost_per_page',
    align: 'right',
    width: 140,
    sorter: sorter('cost_per_page'),
    render: (v) =>
      v == null
        ? <Typography.Text type="secondary">—</Typography.Text>
        : fmtNum(v, ' ₽'),
  },
]

// ---------------------------------------------------------------------------
// AnalyticsPage
// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
  // ---- Filter state (UI) ----
  const [rangeValue,  setRangeValue]  = useState(null)
  const [branchId,    setBranchId]    = useState(undefined)
  const [deptId,      setDeptId]      = useState(undefined)

  // ---- Dictionaries ----
  const [branches,  setBranches]  = useState([])
  const [allDepts,  setAllDepts]  = useState([])

  // ---- Data ----
  const [summary,   setSummary]   = useState(null)
  const [costs,     setCosts]     = useState([])

  // ---- Loading flags ----
  const [loadingSum,   setLoadingSum]   = useState(false)
  const [loadingCost,  setLoadingCost]  = useState(false)
  const [dictsLoading, setDictsLoading] = useState(false)
  const [exporting,    setExporting]    = useState(false)

  // ---- Current applied params (for export) ----
  const [appliedParams, setAppliedParams] = useState({})

  // Load dictionaries once
  useEffect(() => {
    setDictsLoading(true)
    Promise.all([api.get('/orgs/branches'), api.get('/orgs/departments')])
      .then(([bRes, dRes]) => {
        setBranches(bRes.data)
        setAllDepts(dRes.data)
      })
      .catch(() => message.error('Не удалось загрузить справочники'))
      .finally(() => setDictsLoading(false))
  }, [])

  const loadData = useCallback(async (params) => {
    const dateParams = {}
    if (params.date_from) dateParams.date_from = params.date_from
    if (params.date_to)   dateParams.date_to   = params.date_to

    setLoadingSum(true)
    setLoadingCost(true)

    // summary: date only (backend doesn't support branch/dept filter)
    api.get('/analytics/summary', { params: dateParams })
      .then(({ data }) => setSummary(data))
      .catch(() => message.error('Ошибка загрузки сводки'))
      .finally(() => setLoadingSum(false))

    // costs: full filter
    api.get('/analytics/costs', { params })
      .then(({ data }) => setCosts(data))
      .catch(() => message.error('Ошибка загрузки данных'))
      .finally(() => setLoadingCost(false))
  }, [])

  // Initial load
  useEffect(() => { loadData({}) }, [loadData])

  // ---- Apply filters ----
  const handleApply = () => {
    const params = {}
    if (rangeValue?.[0]) params.date_from = rangeValue[0].format('YYYY-MM-DD')
    if (rangeValue?.[1]) params.date_to   = rangeValue[1].format('YYYY-MM-DD')
    if (branchId)   params.branch_id     = branchId
    if (deptId)     params.department_id = deptId
    setAppliedParams(params)
    loadData(params)
  }

  // ---- Export ----
  const handleExport = async () => {
    setExporting(true)
    try {
      const res = await api.get('/analytics/export', {
        params: appliedParams,
        responseType: 'blob',
      })
      const url  = URL.createObjectURL(new Blob([res.data]))
      const link = document.createElement('a')
      link.href  = url
      link.download = res.headers['content-disposition']
        ?.match(/filename=(.+)/)?.[1] ?? 'costs_report.xlsx'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch {
      message.error('Ошибка экспорта')
    } finally {
      setExporting(false)
    }
  }

  // ---- Derived ----
  const totalCostFiltered = costs.reduce((s, r) => s + r.total_cost, 0)
  const deptOptions = branchId
    ? allDepts.filter((d) => d.branch_id === branchId)
    : allDepts

  // ---- Render ----
  return (
    <>
      <Typography.Title level={3} style={{ marginTop: 0 }}>Аналитика</Typography.Title>

      {/* Filters */}
      <Card style={{ marginBottom: 20 }}>
        <Space wrap size={12} className="filter-space" style={{ width: '100%' }}>
          <RangePicker
            value={rangeValue}
            onChange={setRangeValue}
            format="DD.MM.YYYY"
            allowClear
            placeholder={['Дата от', 'Дата до']}
            presets={[
              { label: 'Текущий месяц',  value: [dayjs().startOf('month'),  dayjs().endOf('month')]  },
              { label: 'Текущий год',    value: [dayjs().startOf('year'),   dayjs().endOf('year')]   },
              { label: 'Прошлый год',    value: [dayjs().subtract(1, 'year').startOf('year'),
                                                  dayjs().subtract(1, 'year').endOf('year')]          },
            ]}
          />
          <Select
            style={{ width: 176 }}
            placeholder="Все филиалы"
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
            value={branchId}
            onChange={(v) => { setBranchId(v); setDeptId(undefined) }}
            loading={dictsLoading}
            allowClear
          />
          <Select
            style={{ width: 196 }}
            placeholder="Все отделы"
            options={deptOptions.map((d) => ({ value: d.id, label: d.name }))}
            value={deptId}
            onChange={setDeptId}
            loading={dictsLoading}
            allowClear
          />
          <Button
            type="primary"
            icon={<SearchOutlined />}
            onClick={handleApply}
            loading={loadingCost || loadingSum}
          >
            Применить
          </Button>
        </Space>
      </Card>

      {/* Summary cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} sm={8}>
          <Card loading={loadingSum}>
            <Statistic
              title="Активных устройств"
              value={summary?.total_devices_active ?? 0}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>

        <Col xs={24} sm={8}>
          <Card loading={loadingCost}>
            <Statistic
              title={
                branchId || deptId
                  ? 'Затраты за период (по фильтру)'
                  : 'Общие затраты за период'
              }
              value={totalCostFiltered}
              formatter={(v) => fmt(v)}
              valueStyle={{ color: totalCostFiltered > 0 ? '#cf1322' : undefined }}
            />
          </Card>
        </Col>

        <Col xs={24} sm={8}>
          <RepairTypeCard data={summary?.repairs_by_type} loading={loadingSum} />
        </Col>
      </Row>

      {/* Costs table */}
      <Card
        title={<Typography.Text strong>Затраты по устройствам</Typography.Text>}
        extra={
          <Button
            icon={<FileExcelOutlined />}
            loading={exporting}
            onClick={handleExport}
          >
            Экспорт в Excel
          </Button>
        }
      >
        <Table
          rowKey="device_id"
          dataSource={costs}
          columns={COLUMNS}
          loading={loadingCost}
          size="small"
          scroll={{ x: 'max-content' }}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (total) => `Всего: ${total}`,
          }}
          summary={(pageData) => {
            const repairTotal  = pageData.reduce((s, r) => s + r.total_repair_cost, 0)
            const consTotal    = pageData.reduce((s, r) => s + r.total_consumable_cost, 0)
            const grandTotal   = pageData.reduce((s, r) => s + r.total_cost, 0)
            return (
              <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 600 }}>
                <Table.Summary.Cell index={0} colSpan={3}>
                  Итого по странице
                </Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="right">{fmt(repairTotal)}</Table.Summary.Cell>
                <Table.Summary.Cell index={4} />
                <Table.Summary.Cell index={5} align="right">{fmt(consTotal)}</Table.Summary.Cell>
                <Table.Summary.Cell index={6} align="right">
                  <Typography.Text strong>{fmt(grandTotal)}</Typography.Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={7} />
              </Table.Summary.Row>
            )
          }}
        />
      </Card>
    </>
  )
}
