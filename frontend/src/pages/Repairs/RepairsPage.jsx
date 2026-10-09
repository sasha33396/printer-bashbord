import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Descriptions, Input, Modal, Popconfirm, Select, Space, Tag, message } from 'antd'
import { CheckOutlined, DeleteOutlined, EditOutlined, FilePdfOutlined, FileTextOutlined, PlusOutlined, ReloadOutlined, ToolOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import api from '../../api/api'
import Table from '../../components/FilterableTable'
import PageHeading from '../../components/PageHeading'
import KpiCards from '../../components/KpiCards'
import RepairEditorModal from '../../components/RepairEditorModal'
import RepairReportModal from '../../components/RepairReportModal'
import { useRecordNavigation, useRecordPanel } from '../../components/RecordPanelContext'

const statuses = { in_progress: { label: 'В ремонте', color: 'orange' }, completed: { label: 'Завершён', color: 'green' }, impossible: { label: 'Ремонт невозможен', color: 'red' } }
const types = { planned: 'Плановый', unplanned: 'Внеплановый', warranty: 'Гарантийный' }
const fmtDate = (value) => value ? dayjs(value).format('DD.MM.YYYY') : '—'
const money = (value) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(value || 0)
const errorText = (error) => typeof error.response?.data?.detail === 'string' ? error.response.data.detail : 'Не удалось выполнить операцию'

export default function RepairsPage() {
  const [rows, setRows] = useState([])
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState()
  const [selectedId, setSelectedId] = useState(null)
  const [editor, setEditor] = useState(null)
  const [report, setReport] = useState(null)
  const [chooseDevice, setChooseDevice] = useState(false)
  const [deviceId, setDeviceId] = useState()
  const [busy, setBusy] = useState(null)
  const navigate = useRecordNavigation()
  const { revision } = useRecordPanel()
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [repairsResponse, devicesResponse] = await Promise.all([api.get('/repairs'), api.get('/devices')])
      setRows(repairsResponse.data); setDevices(devicesResponse.data)
    } catch (error) { setError(errorText(error)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load, revision])
  const deviceFor = (row) => devices.find((device) => device.id === row?.device_id) || row?.device
  const selected = rows.find((row) => row.id === selectedId)
  const filtered = useMemo(() => rows.filter((row) => (!status || row.repair_status === status)
    && [row.description, row.device?.inventory_number, row.device?.model, row.contractor, row.responsible_person]
      .some((value) => String(value || '').toLowerCase().includes(search.trim().toLowerCase()))), [rows, status, search])
  const mutate = async (row, action) => {
    setBusy(row.id)
    try {
      if (action === 'complete') await api.post(`/repairs/${row.id}/complete`)
      else await api.delete(`/repairs/${row.id}`)
      message.success(action === 'complete' ? 'Ремонт завершён' : 'Запись удалена')
      await load()
    } catch (error) { message.error(errorText(error)) }
    finally { setBusy(null) }
  }
  const invoice = async (row) => {
    try {
      const { data } = await api.get(`/repairs/${row.id}/invoice`, { responseType: 'blob' })
      const url = URL.createObjectURL(data); const link = document.createElement('a')
      link.href = url; link.download = row.invoice_name || 'invoice.pdf'; link.click(); URL.revokeObjectURL(url)
    } catch (error) { message.error(errorText(error)) }
  }
  const actions = (row) => <Space wrap size={4}>
    <Button size="small" icon={<EditOutlined />} title="Редактировать ремонт" aria-label="Редактировать ремонт" onClick={() => setEditor({ editing: row, device: deviceFor(row) })} />
    <Button size="small" icon={<FileTextOutlined />} title="Сформировать отчёт" aria-label="Сформировать отчёт" onClick={() => setReport(row)} />
    {row.invoice_name && <Button size="small" icon={<FilePdfOutlined />} title="Скачать PDF-счёт" aria-label="Скачать PDF-счёт" onClick={() => invoice(row)} />}
    {row.repair_status === 'in_progress' && <Popconfirm title="Завершить ремонт?" description="Будет получен текущий счётчик и рассчитана печать с предыдущего ремонта." okText="Завершить" cancelText="Отмена" onConfirm={() => mutate(row, 'complete')}>
      <Button size="small" icon={<CheckOutlined />} loading={busy === row.id} disabled={busy !== null} title="Завершить ремонт" aria-label="Завершить ремонт" />
    </Popconfirm>}
    <Popconfirm title="Удалить ремонт?" okText="Удалить" cancelText="Отмена" okButtonProps={{ danger: true }} onConfirm={() => mutate(row, 'delete')}>
      <Button danger size="small" icon={<DeleteOutlined />} disabled={busy !== null} title="Удалить ремонт" aria-label="Удалить ремонт" />
    </Popconfirm>
  </Space>
  const detail = selected && <Card className="repair-detail" title={`Ремонт № ${selected.id}`} extra={<Button type="text" onClick={() => setSelectedId(null)}>Закрыть</Button>}>
    <Tag color={statuses[selected.repair_status]?.color}>{statuses[selected.repair_status]?.label}</Tag>
    <div className="repair-detail-actions">{actions(selected)}</div>
    <Descriptions column={1} size="small" items={[
      { key: 'device', label: 'Устройство', children: <Button type="link" onClick={() => navigate(`/devices/${selected.device_id}`)}>{[selected.device?.manufacturer, selected.device?.model].filter(Boolean).join(' ')}</Button> },
      { key: 'number', label: 'Инв. №', children: selected.device?.inventory_number || '—' },
      { key: 'type', label: 'Тип', children: types[selected.repair_type] || selected.repair_type },
      { key: 'problem', label: 'Неисправность', children: selected.description },
      { key: 'source', label: 'Место', children: selected.source_location || '—' },
      { key: 'responsible', label: 'Ответственный', children: selected.responsible_person || '—' },
      { key: 'contractor', label: 'Исполнитель', children: selected.contractor || '—' },
      { key: 'date', label: 'Передан', children: fmtDate(selected.date) },
      { key: 'returned', label: 'Возвращён', children: fmtDate(selected.returned_date) },
      { key: 'connected', label: 'Подключён', children: fmtDate(selected.connected_date) },
      { key: 'taskDate', label: 'Дата задачи', children: fmtDate(selected.task_date) },
      { key: 'task', label: 'Задача', children: /^https?:\/\//i.test(selected.task_url || '') ? <a href={selected.task_url} target="_blank" rel="noopener noreferrer">{selected.task_url}</a> : selected.task_url || '—' },
      { key: 'cost', label: 'Стоимость', children: money(selected.cost) },
      { key: 'counter', label: 'Счётчик при завершении', children: selected.completion_page_counter ?? '—' },
      { key: 'startCounter', label: 'Счётчик ремонта', children: selected.page_counter ?? '—' },
      { key: 'delta', label: 'Напечатано за период', children: selected.page_counter_delta ?? '—' },
      { key: 'notes', label: 'Примечание', children: selected.notes || '—' },
    ]} />
    <h2 className="section-title">Выполненные работы</h2>
    <Table rowKey="id" dataSource={selected.work_items || []} pagination={false} columns={[{ title: 'Описание', dataIndex: 'description' }, { title: 'Стоимость', dataIndex: 'cost', width: 110, render: money }]} />
    <Button className="repair-history-link" onClick={() => navigate(`/history?entity_type=device&entity_id=${selected.device_id}`)}>История устройства и ремонтов</Button>
  </Card>
  return <>
    <PageHeading title="Ремонты" description="Сервисный учёт, выполненные работы, счета и история ремонтов" actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => { setDeviceId(undefined); setChooseDevice(true) }}>Создать ремонт</Button>} />
    {error && <Alert className="page-alert" type="error" showIcon message={error} action={<Button onClick={load}>Повторить</Button>} />}
    <KpiCards loading={loading} items={[
      { label: 'В ремонте', value: error ? null : rows.filter((row) => row.repair_status === 'in_progress').length, icon: <ToolOutlined />, tone: 'amber' },
      { label: 'Завершено', value: error ? null : rows.filter((row) => row.repair_status === 'completed').length, tone: 'green' },
      { label: 'Ремонт невозможен', value: error ? null : rows.filter((row) => row.repair_status === 'impossible').length, tone: 'red' },
      { label: 'Стоимость всех ремонтов', value: error ? null : money(rows.reduce((sum, row) => sum + (row.cost || 0), 0)) },
    ]} />
    <div className="page-toolbar"><Input.Search allowClear value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Устройство, неисправность, исполнитель" style={{ width: 320 }} />
      <Select allowClear placeholder="Все состояния" value={status} onChange={setStatus} style={{ width: 200 }} options={Object.entries(statuses).map(([value, item]) => ({ value, label: item.label }))} />
      <Button onClick={() => { setSearch(''); setStatus(undefined) }}>Сбросить</Button><div className="toolbar-actions"><Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Обновить</Button></div>
    </div>
    <div className={`repairs-grid${selected ? ' has-selection' : ''}`}>
      <div className="workspace-main"><Table rowKey="id" dataSource={filtered} loading={loading} scroll={{ x: 'max-content' }}
        rowClassName={(row) => row.id === selectedId ? 'selected-record-row' : ''}
        onRow={(row) => ({ onClick: (event) => { if (!event.target.closest('button,a,input,.ant-tag')) setSelectedId(row.id) } })}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, showTotal: (total) => `Ремонтов: ${total}` }} columns={[
          { title: '№', dataIndex: 'id', width: 75, render: (value) => <Button type="link" onClick={() => setSelectedId(value)}>{value}</Button> },
          { title: 'Инв. №', key: 'inventory', width: 120, render: (_, row) => row.device?.inventory_number || '—' },
          { title: 'Устройство', key: 'device', width: 200, render: (_, row) => [row.device?.manufacturer, row.device?.model].filter(Boolean).join(' ') },
          { title: 'Неисправность', dataIndex: 'description', width: 220 },
          { title: 'Передан', dataIndex: 'date', width: 110, sorter: (a, b) => a.date.localeCompare(b.date), defaultSortOrder: 'descend', render: fmtDate },
          { title: 'Тип', dataIndex: 'repair_type', width: 130, render: (value) => types[value] || value },
          { title: 'Исполнитель', dataIndex: 'contractor', width: 150 },
          { title: 'Ответственный', dataIndex: 'responsible_person', width: 150 },
          { title: 'Состояние', dataIndex: 'repair_status', width: 175, render: (value) => <Tag color={statuses[value]?.color}>{statuses[value]?.label || value}</Tag> },
          { title: 'Стоимость', dataIndex: 'cost', width: 120, render: money, sorter: (a, b) => a.cost - b.cost },
          { title: 'Действия', key: 'actions', width: 180, fixed: 'right', filterable: false, render: (_, row) => actions(row) },
        ]} /></div>{detail}
    </div>
    <Modal title="Выберите устройство для ремонта" open={chooseDevice} onCancel={() => setChooseDevice(false)} okText="Продолжить" cancelText="Отмена" okButtonProps={{ disabled: !deviceId }} onOk={() => { setChooseDevice(false); setEditor({ editing: null, device: devices.find((row) => row.id === deviceId) }) }}>
      <Select aria-label="Устройство" showSearch optionFilterProp="label" value={deviceId} onChange={setDeviceId} style={{ width: '100%' }} options={devices.map((row) => ({ value: row.id, label: [row.inventory_number, row.manufacturer, row.model].filter(Boolean).join(' · ') }))} />
    </Modal>
    <RepairEditorModal open={Boolean(editor)} editing={editor?.editing} device={editor?.device} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); load() }} />
    <RepairReportModal open={Boolean(report)} repair={report} device={deviceFor(report)} onClose={() => setReport(null)} />
  </>
}
