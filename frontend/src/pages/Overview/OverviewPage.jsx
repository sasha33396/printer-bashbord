import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Tag } from 'antd'
import { DesktopOutlined, InboxOutlined, PrinterOutlined, ReloadOutlined, SafetyCertificateOutlined, ToolOutlined, FileTextOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import dayjs from 'dayjs'
import api from '../../api/api'
import PageHeading from '../../components/PageHeading'
import KpiCards from '../../components/KpiCards'
import DistributionCard from '../../components/DistributionCard'
import Table from '../../components/FilterableTable'
import { useRecordNavigation, useRecordPanel } from '../../components/RecordPanelContext'
import { expiringDocuments, groupCounts, inventoryAssets } from '../../utils/overview'

const endpoints = { devices: '/devices', items: '/warehouse/items', workplaces: '/workplaces', repairs: '/repairs',
  ecp: '/digital-documents/signatures', mchd: '/digital-documents/powers-of-attorney', history: '/history' }
const labels = { devices: 'принтеры', items: 'склад', workplaces: 'рабочие места', repairs: 'ремонты', ecp: 'ЭЦП', mchd: 'МЧД', history: 'история' }
const fmtDate = (value) => value ? dayjs(value).format('DD.MM.YYYY') : '—'

export default function OverviewPage() {
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)
  const [errors, setErrors] = useState([])
  const navigate = useRecordNavigation()
  const { revision } = useRecordPanel()
  const load = useCallback(async (signal) => {
    setLoading(true)
    const entries = Object.entries(endpoints)
    const results = await Promise.allSettled(entries.map(([key, path]) => api.get(path, { signal,
      params: key === 'history' ? { page: 1, page_size: 8 } : undefined })))
    if (signal?.aborted) return
    const next = {}; const failed = []
    results.forEach((result, index) => {
      const key = entries[index][0]
      if (result.status === 'fulfilled') next[key] = result.value.data
      else failed.push(key)
    })
    setData(next); setErrors(failed); setLoading(false)
  }, [])
  useEffect(() => { const request = new AbortController(); load(request.signal); return () => request.abort() }, [load, revision])
  const { devices = [], items = [], workplaces = [], repairs = [], ecp = [], mchd = [] } = data
  const inventoryReady = Boolean(data.devices && data.items)
  const assets = inventoryAssets(devices, items)
  const upcoming = expiringDocuments(ecp, mchd)
  const activeRepairs = repairs.filter((row) => row.repair_status === 'in_progress')
  const statusRows = groupCounts(assets, (row) => row.status ? ({ active: 'В эксплуатации', repair: 'В ремонте', decommissioned: 'Списано' }[row.status] || row.status) : row.condition)
  return <>
    <PageHeading title="Панель управления" description="Учёт оборудования, рабочих мест, ремонтов и электронных документов"
      actions={<Button icon={<ReloadOutlined />} loading={loading} onClick={() => load()}>Обновить</Button>} />
    {errors.length > 0 && <Alert className="page-alert" type="warning" showIcon message={`Не удалось загрузить: ${errors.map((key) => labels[key]).join(', ')}. Повторите загрузку.`} />}
    <KpiCards loading={loading} items={[
      { label: 'Всего устройств', value: inventoryReady ? assets.length : null, icon: <PrinterOutlined />, note: 'Печатающая техника и поштучное оборудование' },
      { label: 'На складе', value: data.items ? items.filter((row) => row.tracking_type === 'asset' && !row.workplace && !row.is_archived && row.condition === 'На складе').length : null, icon: <InboxOutlined />, tone: 'green', note: 'Поштучное оборудование со статусом «На складе»' },
      { label: 'Рабочие места', value: data.workplaces ? workplaces.length : null, icon: <DesktopOutlined />, note: 'Всего в реестре' },
      { label: 'В ремонте', value: data.repairs ? activeRepairs.length : null, icon: <ToolOutlined />, tone: 'red', note: 'Незавершённые ремонтные записи' },
      { label: 'Истекающие ЭЦП', value: data.ecp ? ecp.filter((row) => row.term_status === 'expiring').length : null, icon: <SafetyCertificateOutlined />, tone: 'amber', note: 'В течение 30 дней' },
      { label: 'Активные МЧД', value: data.mchd ? mchd.filter((row) => ['valid', 'expiring'].includes(row.term_status)).length : null, icon: <FileTextOutlined />, note: 'По сроку действия' },
    ]} />
    <div className="overview-charts">
      <DistributionCard title="Оборудование по филиалам" rows={groupCounts(assets, (row) => row.branch?.name)} loading={loading} unavailable={!inventoryReady} />
      <DistributionCard title="Состояние устройств" rows={statusRows} loading={loading} unavailable={!inventoryReady} />
      <DistributionCard title="Категории оборудования" rows={groupCounts(assets, (row) => row.category)} donut loading={loading} unavailable={!inventoryReady} />
    </div>
    <div className="overview-details">
      <Card title="Последняя активность" extra={<Link to="/history">Все события →</Link>}>
        <Table rowKey="id" loading={loading} dataSource={data.history?.items || []} pagination={false} scroll={{ x: 620 }} locale={{ emptyText: errors.includes('history') ? 'История недоступна' : 'Событий пока нет' }} columns={[
          { title: 'Дата и время', dataIndex: 'occurred_at', width: 140, render: (value) => dayjs(value).format('DD.MM.YYYY HH:mm') },
          { title: 'Событие', dataIndex: 'title', width: 190 },
          { title: 'Объект', key: 'object', render: (_, row) => [row.inventory_number, row.entity_name].filter(Boolean).join(' · ') || '—' },
          { title: 'Пользователь', dataIndex: 'actor', width: 110 },
        ]} />
      </Card>
      <div className="overview-side">
        <Card title="Ближайшее истечение ЭЦП и МЧД" extra={<Link to="/digital-documents/ecp">Реестры →</Link>}>
          <Table rowKey={(row) => `${row.kind}-${row.id}`} loading={loading} dataSource={upcoming.slice(0, 5)} pagination={false} scroll={{ x: 425 }} locale={{ emptyText: errors.some((key) => ['ecp', 'mchd'].includes(key)) ? 'Часть реестров недоступна' : 'Нет записей с близким сроком окончания' }} columns={[
            { title: 'Владелец', dataIndex: 'owner', width: 260, ellipsis: true, render: (value, row) => <Button type="link" onClick={() => navigate(`/digital-documents/${row.kind}/${row.id}`)}>{value}</Button> },
            { title: 'Тип', dataIndex: 'kind', width: 55, render: (value) => value === 'ecp' ? 'ЭЦП' : 'МЧД' },
            { title: 'Окончание', dataIndex: 'valid_to', width: 110, render: (value) => <Tag color="orange">{fmtDate(value)}</Tag> },
          ]} />
        </Card>
        <Card title="Очередь ремонтов" extra={<Link to="/repairs">Все ремонты →</Link>}>
          <Table rowKey="id" loading={loading} dataSource={activeRepairs.slice(0, 5)} pagination={false} scroll={{ x: 360 }} locale={{ emptyText: errors.includes('repairs') ? 'Ремонты недоступны' : 'Активных ремонтов нет' }} columns={[
            { title: 'Устройство', key: 'device', render: (_, row) => <Button type="link" onClick={() => navigate(`/devices/${row.device_id}`)}>{row.device?.inventory_number || row.device?.model}</Button> },
            { title: 'Неисправность', dataIndex: 'description' },
            { title: 'Принято', dataIndex: 'date', width: 100, render: fmtDate },
          ]} />
        </Card>
      </div>
    </div>
  </>
}
