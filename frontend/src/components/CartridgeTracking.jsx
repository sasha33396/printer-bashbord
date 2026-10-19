import { Alert, Space, Tag, Timeline, Typography } from 'antd'
import dayjs from 'dayjs'
import Table from './FilterableTable'
import { CARTRIDGE_OPERATIONS, CARTRIDGE_STATES, cartridgeCycles, STATE_COLORS } from '../utils/cartridges'

export const cartridgeDate = (value) => value ? dayjs(value).format('DD.MM.YYYY') : '—'
export const counterText = (value) => value == null ? 'Не указан' : value.toLocaleString('ru-RU')
export const sinceText = (date, days) => date ? `${cartridgeDate(date)} · ${days ?? '—'} дн.` : 'Дата неизвестна'

export function RefillDeadline({ item }) {
  if (item.state !== 'refilling') return '—'
  return item.expected_return_date
    ? <Tag color={item.refill_overdue ? 'red' : 'default'}>{cartridgeDate(item.expected_return_date)}
      {item.refill_overdue ? ` · просрочено ${item.overdue_days} дн.` : ''}</Tag>
    : <Tag color="orange">Срок не задан</Tag>
}

export function CartridgeTimeline({ operations }) {
  if (!operations.length) return <Alert type="info" message="Операции ещё не зарегистрированы" />
  const ordered = [...operations].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
  return <Timeline style={{ marginTop: 20, paddingLeft: 8 }} items={ordered.map((event) => ({
    key: event.id, color: STATE_COLORS[event.to_state] === 'default' ? 'gray' : STATE_COLORS[event.to_state],
    children: <div style={{ paddingBottom: 12 }}>
      <Space wrap><Typography.Text strong>{cartridgeDate(event.date)} — {CARTRIDGE_OPERATIONS[event.operation] || event.operation}</Typography.Text>
        <Tag>{CARTRIDGE_STATES[event.to_state]}</Tag></Space>
      <div>{event.from_location ? `${event.from_location} → ` : ''}{event.to_location}</div>
      {event.device_name && <div>Принтер: {event.device_name}{event.slot ? ` · ${event.slot}` : ''}</div>}
      {event.contractor && <div>Подрядчик: {event.contractor}</div>}
      {['send_refill', 'refill_deadline'].includes(event.operation) && <div>Ожидаемый возврат: {cartridgeDate(event.expected_return_date)}</div>}
      {event.page_counter != null && <div>Счётчик: {counterText(event.page_counter)}</div>}
      {event.pages_printed != null && <div>Напечатано за цикл: {counterText(event.pages_printed)} стр.</div>}
      <Typography.Text type="secondary">Оформил: {event.actor}</Typography.Text>
      {event.notes && <div style={{ whiteSpace: 'pre-wrap' }}>{event.notes}</div>}
    </div>,
  }))} />
}

export function CartridgeResourceHistory({ operations }) {
  return <>
    <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Ресурс — разница счётчиков принтера при снятии и установке."
      description="Если хотя бы одно показание отсутствует, ресурс цикла неизвестен. При замене одно показание используется для снятия старого и установки нового картриджа." />
    <Table rowKey="id" dataSource={cartridgeCycles(operations)} scroll={{ x: 'max-content' }} columns={[
      { title: 'Картридж', dataIndex: 'inventory_number' },
      { title: 'Принтер', dataIndex: 'device_name' },
      { title: 'Место / цвет', dataIndex: 'slot' },
      { title: 'Установлен', dataIndex: 'installed_at', render: cartridgeDate },
      { title: 'Снят', dataIndex: 'date', render: cartridgeDate },
      { title: 'Счётчик при установке', dataIndex: 'initial_counter', render: counterText },
      { title: 'Счётчик при снятии', dataIndex: 'page_counter', render: counterText },
      { title: 'Напечатано, стр.', dataIndex: 'pages_printed', render: (value) => value == null ? 'Неизвестно' : counterText(value) },
    ]} />
  </>
}
