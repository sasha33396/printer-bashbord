import { useCallback, useEffect, useState } from 'react'
import {
  Button, DatePicker, Empty, Form, Input, Modal, Popconfirm,
  Select, Space, Spin, Table, Tag, Typography, message,
} from 'antd'
import {
  ArrowLeftOutlined, DesktopOutlined, PlusOutlined, PrinterOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import api from '../../api/api'
import { printQrLabel } from '../../utils/qr'
import { apiError, WORKPLACE_STATUS } from './WorkplacesPage'

const fmtDate = (value) => value ? dayjs(value).format('DD.MM.YYYY') : '—'

function DetailField({ label, value, wide = false }) {
  const missing = value === null || value === undefined || value === ''
  return <div className={wide ? 'workplace-detail-field workplace-detail-wide' : 'workplace-detail-field'}>
    <div className="inventory-detail-label">{label}</div>
    <div className={missing ? 'inventory-detail-value inventory-detail-empty' : 'inventory-detail-value'}>
      {missing ? '—' : value}
    </div>
  </div>
}

function AssignmentModal({ open, workplace, onClose, onSaved }) {
  const [form] = Form.useForm()
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    form.resetFields()
    form.setFieldsValue({ assigned_at: dayjs() })
    setLoading(true)
    api.get('/workplaces/available-assets')
      .then(({ data }) => setAssets(data))
      .catch((error) => message.error(apiError(error, 'Не удалось загрузить свободное оборудование')))
      .finally(() => setLoading(false))
  }, [open, form])

  const save = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      await api.post(`/workplaces/${workplace.id}/assignments`, {
        ...values,
        assigned_at: values.assigned_at.format('YYYY-MM-DD'),
      })
      message.success('Оборудование установлено на рабочее место')
      onSaved()
    } catch (error) {
      message.error(apiError(error, 'Не удалось добавить оборудование'))
    } finally {
      setSaving(false)
    }
  }

  return <Modal
    title="Добавить оборудование"
    open={open}
    onOk={save}
    onCancel={onClose}
    confirmLoading={saving}
    okText="Добавить"
    cancelText="Отмена"
    destroyOnClose
  >
    <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
      <Form.Item name="item_id" label="Оборудование" rules={[{ required: true, message: 'Выберите оборудование' }]}>
        <Select
          showSearch optionFilterProp="label" loading={loading}
          placeholder="Свободное оборудование с поштучным учётом"
          options={assets.map((item) => ({
            value: item.id,
            label: `${item.category} · ${item.inventory_number || 'без №'} · ${item.manufacturer || ''} ${item.model || item.name}`.trim(),
          }))}
        />
      </Form.Item>
      <Form.Item name="assigned_at" label="Дата установки" rules={[{ required: true }]}>
        <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item name="notes" label="Примечание"><Input.TextArea rows={2} /></Form.Item>
    </Form>
  </Modal>
}

export default function WorkplaceCardPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [workplace, setWorkplace] = useState(null)
  const [loading, setLoading] = useState(true)
  const [assignmentOpen, setAssignmentOpen] = useState(false)
  const [endingId, setEndingId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get(`/workplaces/${id}`)
      setWorkplace(data)
    } catch (error) {
      message.error(apiError(error, 'Рабочее место не найдено'))
      navigate('/workplaces', { replace: true })
    } finally {
      setLoading(false)
    }
  }, [id, navigate])

  useEffect(() => { load() }, [load])

  const printLabel = async () => {
    try {
      await printQrLabel({
        path: `/workplaces/${workplace.id}`,
        inventoryNumber: workplace.name,
        title: workplace.branch?.name || 'Рабочее место',
        subtitle: [workplace.department?.name, workplace.location].filter(Boolean).join(' / '),
      })
    } catch (error) {
      message.error(error.message || 'Не удалось сформировать этикетку')
    }
  }

  const endAssignment = async (assignment) => {
    setEndingId(assignment.id)
    try {
      await api.post(`/workplaces/assignments/${assignment.id}/end`, {
        ended_at: dayjs().format('YYYY-MM-DD'),
      })
      message.success('Оборудование снято с рабочего места')
      load()
    } catch (error) {
      message.error(apiError(error, 'Не удалось снять оборудование'))
    } finally {
      setEndingId(null)
    }
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
  if (!workplace) return null

  const status = WORKPLACE_STATUS[workplace.status] || { label: workplace.status, color: 'default' }
  const historyColumns = [
    { title: 'Оборудование', key: 'item', render: (_, row) => `${row.item.category} · ${row.item.inventory_number || 'без №'} · ${row.item.model || row.item.name}` },
    { title: 'Установлено', dataIndex: 'assigned_at', width: 120, render: fmtDate },
    { title: 'Снято', dataIndex: 'ended_at', width: 120, render: fmtDate },
    { title: 'Примечание', dataIndex: 'notes', render: (value) => value || '—' },
  ]

  return <div className="workplace-detail-page">
    <Button className="inventory-detail-back" type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/workplaces')}>
      Рабочие места
    </Button>

    <section className="workplace-main-card">
      <header className="inventory-detail-header">
        <div className="inventory-detail-heading">
          <div className="inventory-detail-title-row">
            <h1>{workplace.name}</h1>
            <span className="inventory-category-badge">Рабочее место</span>
          </div>
          <div className="inventory-detail-summary">
            <span className={`workplace-status-dot-label workplace-status-${workplace.status}`}>
              <span className="inventory-status-dot" />{status.label}
            </span>
            <span><span className="inventory-summary-label">Оборудование</span> {workplace.current_assets.length}</span>
          </div>
        </div>
        <Button type="primary" icon={<PrinterOutlined />} onClick={printLabel}>Распечатать QR</Button>
      </header>

      <div className="inventory-detail-divider" />
      <div className="inventory-detail-grid">
        <DetailField label="Филиал" value={workplace.branch?.name} />
        <DetailField label="Отдел" value={workplace.department?.name} />
        <DetailField label="Кабинет / расположение" value={workplace.location} />
        <DetailField label="Сотрудник" value={workplace.employee?.full_name} />
        <DetailField label="Должность" value={workplace.employee?.position} />
        <DetailField label="Телефон сотрудника" value={workplace.employee?.phone} />
        <DetailField label="E-mail" value={workplace.employee?.email} />
        <DetailField label="Примечание" value={workplace.notes} />
      </div>
    </section>

    <section className="workplace-section">
      <div className="workplace-section-header">
        <div>
          <h2>Оборудование</h2>
          <p>Системный блок, мониторы и телефон этого рабочего места</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAssignmentOpen(true)}>Добавить оборудование</Button>
      </div>
      {workplace.current_assets.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Оборудование не назначено" /> : (
        <div className="workplace-assets">
          {workplace.current_assets.map((assignment) => (
            <article className="workplace-asset-row" key={assignment.id}>
              <div className="workplace-asset-icon"><DesktopOutlined /></div>
              <div className="workplace-asset-main">
                <strong>{assignment.item.manufacturer} {assignment.item.model || assignment.item.name}</strong>
                <span>{assignment.item.category} · Инв. № {assignment.item.inventory_number || '—'} · S/N {assignment.item.serial_number || '—'}</span>
              </div>
              <Tag>{assignment.item.condition}</Tag>
              <Space size={4}>
                <Button size="small" onClick={() => navigate(`/warehouse/items/${assignment.item.id}`)}>Открыть</Button>
                <Popconfirm
                  title="Снять оборудование с рабочего места?"
                  description="Оно будет возвращено на склад."
                  okText="Снять"
                  cancelText="Отмена"
                  onConfirm={() => endAssignment(assignment)}
                >
                  <Button size="small" danger loading={endingId === assignment.id}>Снять</Button>
                </Popconfirm>
              </Space>
            </article>
          ))}
        </div>
      )}
    </section>

    <section className="workplace-section">
      <div className="workplace-section-header"><div><h2>История оборудования</h2><p>Все установки и снятия с рабочего места</p></div></div>
      <Table
        rowKey="id" dataSource={workplace.assignment_history} columns={historyColumns}
        size="small" scroll={{ x: 'max-content' }} pagination={{ pageSize: 10, hideOnSinglePage: true }}
      />
    </section>

    <AssignmentModal
      open={assignmentOpen} workplace={workplace}
      onClose={() => setAssignmentOpen(false)} onSaved={() => { setAssignmentOpen(false); load() }}
    />
  </div>
}
