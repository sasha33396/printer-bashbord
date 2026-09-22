import { useEffect, useState } from 'react'
import { ArrowLeftOutlined, PrinterOutlined } from '@ant-design/icons'
import { Button, Card, Descriptions, Space, Spin, Tag, Typography, message } from 'antd'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../../api/api'
import { printQrLabel } from '../../utils/qr'

const value = (item) => item ?? <Typography.Text type="secondary">—</Typography.Text>

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

  return (
    <>
      <Space wrap className="page-header" style={{ marginBottom: 20 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/warehouse')}>Склад</Button>
        <Typography.Title level={4} style={{ margin: 0 }}>{item.name}</Typography.Title>
        <Tag>{item.category}</Tag>
        <Button type="primary" icon={<PrinterOutlined />} onClick={printLabel}>Распечатать QR</Button>
      </Space>
      <Card>
        <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
          <Descriptions.Item label="Филиал">{value(item.branch?.name)}</Descriptions.Item>
          <Descriptions.Item label="Отдел">{value(item.department?.name)}</Descriptions.Item>
          <Descriptions.Item label="Местонахождение">{value(item.placement)}</Descriptions.Item>
          <Descriptions.Item label="Способ учёта">{item.tracking_type === 'asset' ? 'Поштучный' : 'По количеству'}</Descriptions.Item>
          <Descriptions.Item label="Инвентарный №">{value(item.inventory_number)}</Descriptions.Item>
          <Descriptions.Item label="Серийный №">{value(item.serial_number)}</Descriptions.Item>
          <Descriptions.Item label="Артикул">{value(item.sku)}</Descriptions.Item>
          <Descriptions.Item label="Производитель">{value(item.manufacturer)}</Descriptions.Item>
          <Descriptions.Item label="Модель">{value(item.model)}</Descriptions.Item>
          <Descriptions.Item label="Состояние">{value(item.condition)}</Descriptions.Item>
          <Descriptions.Item label="Остаток">{item.current_quantity} {item.unit}</Descriptions.Item>
          {item.compatible_printers && <Descriptions.Item label="Для принтеров" span={2}>{item.compatible_printers}</Descriptions.Item>}
          {item.monitor_diagonal != null && <Descriptions.Item label="Диагональ">{item.monitor_diagonal}″</Descriptions.Item>}
          {item.color && <Descriptions.Item label="Цвет">{item.color}</Descriptions.Item>}
          {item.ram_gb != null && <Descriptions.Item label="ОЗУ">{item.ram_gb} ГБ</Descriptions.Item>}
          {item.processor && <Descriptions.Item label="Процессор">{item.processor}</Descriptions.Item>}
          {item.graphics && <Descriptions.Item label="Видеокарта">{item.graphics}</Descriptions.Item>}
          {item.storage_type && <Descriptions.Item label="Накопитель">{item.storage_type}</Descriptions.Item>}
          {item.storage_capacity_gb != null && <Descriptions.Item label="Объём накопителя">{item.storage_capacity_gb} ГБ</Descriptions.Item>}
          {item.notes && <Descriptions.Item label="Примечание" span={3}>{item.notes}</Descriptions.Item>}
        </Descriptions>
      </Card>
    </>
  )
}
