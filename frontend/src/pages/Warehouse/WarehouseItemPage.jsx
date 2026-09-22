import { useEffect, useState } from 'react'
import { ArrowLeftOutlined, PrinterOutlined } from '@ant-design/icons'
import { Button, Spin, message } from 'antd'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../../api/api'
import { printQrLabel } from '../../utils/qr'

const CATEGORY_LABELS = {
  'Компьютеры': 'Компьютер',
  'Мониторы': 'Монитор',
  'Картриджи': 'Картридж',
  'Мыши': 'Мышь',
  'Клавиатуры': 'Клавиатура',
}

function DetailField({ label, value, wide = false }) {
  const missing = value === null || value === undefined || value === ''
  return (
    <div className={`inventory-detail-field${wide ? ' inventory-detail-field-wide' : ''}`}>
      <div className="inventory-detail-label">{label}</div>
      <div className={missing ? 'inventory-detail-value inventory-detail-empty' : 'inventory-detail-value'}>
        {missing ? '—' : value}
      </div>
    </div>
  )
}

export default function WarehouseItemPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [item, setItem] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get(`/warehouse/items/${id}`)
      .then(({ data }) => setItem(data))
      .catch(() => {
        message.error('Складская позиция не найдена')
        navigate('/warehouse', { replace: true })
      })
      .finally(() => setLoading(false))
  }, [id, navigate])

  const printLabel = async () => {
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

  if (loading) return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
  if (!item) return null

  const categoryLabel = CATEGORY_LABELS[item.category] || item.category
  const isHealthy = item.condition === 'Рабочий' || item.condition === 'На складе'
  const statusClass = item.condition === 'Списан'
    ? 'inventory-status-danger'
    : isHealthy ? 'inventory-status-success' : 'inventory-status-warning'
  const storage = [
    item.storage_type,
    item.storage_capacity_gb != null ? `${item.storage_capacity_gb} ГБ` : null,
  ].filter(Boolean).join(' · ')
  const characteristics = []
  if (item.category === 'Компьютеры') {
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

  return (
    <div className="inventory-detail-page">
      <Button
        className="inventory-detail-back"
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate('/warehouse')}
      >
        Склад
      </Button>

      <section className="inventory-detail-card">
        <header className="inventory-detail-header">
          <div className="inventory-detail-heading">
            <div className="inventory-detail-title-row">
              <h1>{item.name}</h1>
              <span className="inventory-category-badge">{categoryLabel}</span>
            </div>
            <div className="inventory-detail-summary">
              <span className={`inventory-status ${statusClass}`}>
                <span className="inventory-status-dot" />
                {item.condition || '—'}
              </span>
              <span className={!item.inventory_number ? 'inventory-detail-empty' : undefined}>
                <span className="inventory-summary-label">Инв. №</span> {item.inventory_number || '—'}
              </span>
              <span><span className="inventory-summary-label">Остаток</span> {item.current_quantity} {item.unit}</span>
            </div>
          </div>
          <Button type="primary" icon={<PrinterOutlined />} onClick={printLabel}>
            Распечатать QR
          </Button>
        </header>

        <div className="inventory-detail-divider" />

        <div className="inventory-detail-grid">
          <DetailField label="Филиал" value={item.branch?.name} />
          <DetailField label="Отдел" value={item.department?.name} />
          <DetailField label="Местонахождение" value={item.placement} />
          <DetailField label="Способ учёта" value={item.tracking_type === 'asset' ? 'Поштучный' : 'По количеству'} />
          <DetailField label="Производитель" value={item.manufacturer} />
          <DetailField label="Модель" value={item.model} />
          <DetailField label="Серийный №" value={item.serial_number} />
          <DetailField label="Артикул" value={item.sku} />
        </div>

        {characteristics.length > 0 && <>
          <div className="inventory-detail-divider" />
          <div className="inventory-detail-grid inventory-characteristics-grid">
            {characteristics.map((field) => (
              <DetailField key={field.label} label={field.label} value={field.value} wide={field.wide} />
            ))}
          </div>
        </>}
      </section>
    </div>
  )
}
