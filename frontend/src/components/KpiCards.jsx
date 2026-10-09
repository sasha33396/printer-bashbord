import { Skeleton } from 'antd'

export default function KpiCards({ items, loading = false }) {
  return <div className="kpi-grid">
    {items.map(({ label, value, icon, note, tone = 'blue' }) => <div className="kpi-card" key={label}>
      <div className="kpi-top"><span>{label}</span>{icon && <span className={`kpi-icon kpi-icon-${tone}`}>{icon}</span>}</div>
      {loading ? <Skeleton.Input active size="small" /> : <strong className="kpi-value">{value == null ? '—' : typeof value === 'number' ? value.toLocaleString('ru-RU') : value}</strong>}
      {note && <div className="kpi-note">{note}</div>}
    </div>)}
  </div>
}
