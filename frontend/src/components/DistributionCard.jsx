import { Card, Empty, Skeleton } from 'antd'

const colors = ['#2563EB', '#38BDF8', '#14B8A6', '#D97706', '#8B5CF6', '#94A3B8']

export default function DistributionCard({ title, rows = [], loading, unavailable, donut = false }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0)
  const max = Math.max(...rows.map((row) => row.count), 1)
  let offset = 0
  const stops = rows.map((row, index) => {
    const start = offset
    offset += total ? row.count / total * 100 : 0
    return `${colors[index % colors.length]} ${start}% ${offset}%`
  })
  return <Card title={title} className="distribution-card">
    {loading ? <Skeleton active /> : unavailable ? <Empty description="Не удалось загрузить данные" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : !total ? <Empty description="Нет данных" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : <div className={donut ? 'distribution-donut-layout' : 'distribution-bars'}>
      {donut && <div className="distribution-donut" role="img" aria-label={`Всего: ${total}. ${rows.map((row) => `${row.label}: ${row.count}`).join(', ')}`} style={{ background: `conic-gradient(${stops.join(',')})` }}>
        <div><strong>{total.toLocaleString('ru-RU')}</strong><span>устройств</span></div>
      </div>}
      <div className="distribution-legend">{rows.map((row, index) => <div key={row.label} className="distribution-row">
        <div className="distribution-label"><span className="legend-dot" style={{ background: colors[index % colors.length] }} /><span title={row.label}>{row.label}</span><strong>{row.count.toLocaleString('ru-RU')}</strong></div>
        {!donut && <div className="distribution-track"><div style={{ width: `${row.count / max * 100}%`, background: colors[index % colors.length] }} /></div>}
      </div>)}</div>
    </div>}
  </Card>
}
