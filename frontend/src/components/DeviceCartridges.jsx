import { useCallback, useEffect, useState } from 'react'
import { Button, Space, Tag, Typography, message } from 'antd'
import Table from './FilterableTable'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { counterText, sinceText } from './CartridgeTracking'
import api from '../api/api'
import { CARTRIDGE_OPERATIONS } from '../utils/cartridges'

export default function DeviceCartridges({ deviceId }) {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cards, operations] = await Promise.all([
        api.get('/cartridges'), api.get('/cartridges/operations', { params: { device_id: deviceId } }),
      ])
      setItems(cards.data.filter((item) => item.device_id === deviceId))
      setHistory(operations.data)
    } catch { message.error('Не удалось загрузить картриджи принтера') }
    finally { setLoading(false) }
  }, [deviceId])
  useEffect(() => { load() }, [load])
  const lastReplacement = history.find((row) => row.operation === 'install')
  return <>
    <div className="workplace-section-header">
      <div><h2>Картриджи</h2><p>{lastReplacement
        ? `Последняя установка / замена: ${dayjs(lastReplacement.date).format('DD.MM.YYYY')}`
        : 'Установки картриджей ещё не зарегистрированы'}</p></div>
      <Space wrap>
        <Button onClick={load} loading={loading}>Обновить</Button>
        <Button type="primary" onClick={() => navigate(`/cartridges?device=${deviceId}&install=1`)}>Заменить / установить</Button>
        <Button onClick={() => navigate(`/cartridges?device=${deviceId}`)}>История и операции</Button>
      </Space>
    </div>
    <Table size="small" rowKey="item_id" loading={loading} dataSource={items} pagination={false} scroll={{ x: 'max-content' }} columns={[
      { title: 'Место / цвет', dataIndex: 'slot' },
      { title: 'Номер наклейки', dataIndex: 'inventory_number', render: (value, item) => <Button type="link" onClick={() => navigate(`/cartridges/${item.item_id}`)}>{value}</Button> },
      { title: 'Модель', dataIndex: 'name' },
      { title: 'Получатель', dataIndex: 'employee_name', render: (value, item) => value || item.department_name || '—' },
      { title: 'Установлен', dataIndex: 'last_installed_at', render: (value) => value ? dayjs(value).format('DD.MM.YYYY') : '—' },
      { title: 'В работе', dataIndex: 'state_since', render: (value, item) => sinceText(value, item.state_days) },
      { title: 'Счётчик при установке', dataIndex: 'installation_page_counter', render: counterText },
    ]} />
    <Typography.Title level={5}>Последние операции</Typography.Title>
    <Table size="small" rowKey="id" loading={loading} dataSource={history.slice(0, 10)} pagination={false} scroll={{ x: 'max-content' }} columns={[
      { title: 'Дата', dataIndex: 'date', render: (value) => dayjs(value).format('DD.MM.YYYY') },
      { title: 'Картридж', dataIndex: 'inventory_number' },
      { title: 'Операция', dataIndex: 'operation', render: (value) => <Tag>{CARTRIDGE_OPERATIONS[value]}</Tag> },
      { title: 'Место / цвет', dataIndex: 'slot' },
    ]} />
  </>
}
