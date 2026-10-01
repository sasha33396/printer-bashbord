import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button, Col, Form, Input, Modal, Popconfirm, Row, Select,
  Space, Table, Tag, Typography, message,
} from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import api from '../../api/api'

export const WORKPLACE_STATUS = {
  occupied: { label: 'Занято', color: 'green' },
  vacant: { label: 'Свободно', color: 'blue' },
  inactive: { label: 'Не используется', color: 'default' },
}

export const apiError = (error, fallback) => {
  const detail = error.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map((item) => item.msg).filter(Boolean).join('; ') || fallback
  return fallback
}

export function WorkplaceModal({ open, editing, branches, departments, employees, onClose, onSaved }) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const branchId = Form.useWatch('branch_id', form)
  const departmentId = Form.useWatch('department_id', form)

  useEffect(() => {
    if (!open) return
    form.resetFields()
    form.setFieldsValue(editing || { status: 'vacant' })
  }, [open, editing, form])

  const availableDepartments = departments.filter((item) => item.branch_id === branchId)
  const availableEmployees = employees.filter((employee) => {
    if (!employee.is_active) return editing?.employee_id === employee.id
    if (branchId && employee.branch_id && employee.branch_id !== branchId) return false
    if (departmentId && employee.department_id && employee.department_id !== departmentId) return false
    return true
  })

  const save = async () => {
    const values = await form.validateFields()
    const payload = {
      ...values,
      department_id: values.department_id ?? null,
      employee_id: values.employee_id ?? null,
    }
    setSaving(true)
    try {
      if (editing) {
        await api.put(`/workplaces/${editing.id}`, payload)
        message.success('Рабочее место обновлено')
      } else {
        await api.post('/workplaces', payload)
        message.success('Рабочее место создано')
      }
      onSaved()
    } catch (error) {
      message.error(apiError(error, 'Не удалось сохранить рабочее место'))
    } finally {
      setSaving(false)
    }
  }

  return <Modal
    title={editing ? 'Редактировать рабочее место' : 'Новое рабочее место'}
    open={open}
    onOk={save}
    onCancel={onClose}
    confirmLoading={saving}
    okText="Сохранить"
    cancelText="Отмена"
    width={720}
    destroyOnClose
  >
    <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item name="name" label="Название / номер" rules={[{ required: true, message: 'Укажите название' }]}>
            <Input placeholder="WS-ОМТС-012" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="status" label="Состояние" rules={[{ required: true }]}>
            <Select options={Object.entries(WORKPLACE_STATUS).map(([value, item]) => ({ value, label: item.label }))} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="branch_id" label="Филиал" rules={[{ required: true, message: 'Выберите филиал' }]}>
            <Select
              showSearch optionFilterProp="label"
              options={branches.map((item) => ({ value: item.id, label: item.name }))}
              onChange={() => { form.setFieldValue('department_id', null); form.setFieldValue('employee_id', null) }}
            />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="department_id" label="Отдел">
            <Select
              allowClear showSearch optionFilterProp="label" disabled={!branchId}
              options={availableDepartments.map((item) => ({ value: item.id, label: item.name }))}
              onChange={() => form.setFieldValue('employee_id', null)}
            />
          </Form.Item>
        </Col>
        <Col span={12}><Form.Item name="location" label="Кабинет / расположение"><Input placeholder="Кабинет 204" /></Form.Item></Col>
        <Col span={12}>
          <Form.Item name="employee_id" label="Сотрудник">
            <Select
              allowClear showSearch optionFilterProp="label"
              options={availableEmployees.map((item) => ({ value: item.id, label: item.full_name }))}
              placeholder="Рабочее место свободно"
            />
          </Form.Item>
        </Col>
        <Col span={24}><Form.Item name="notes" label="Примечание"><Input.TextArea rows={2} /></Form.Item></Col>
      </Row>
    </Form>
  </Modal>
}

export default function WorkplacesPage() {
  const navigate = useNavigate()
  const [workplaces, setWorkplaces] = useState([])
  const [branches, setBranches] = useState([])
  const [departments, setDepartments] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [branchId, setBranchId] = useState()
  const [departmentId, setDepartmentId] = useState()
  const [statusFilter, setStatusFilter] = useState()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [workplaceResponse, branchResponse, departmentResponse, employeeResponse] = await Promise.all([
        api.get('/workplaces'), api.get('/orgs/branches'), api.get('/orgs/departments'), api.get('/employees'),
      ])
      setWorkplaces(workplaceResponse.data)
      setBranches(branchResponse.data)
      setDepartments(departmentResponse.data)
      setEmployees(employeeResponse.data)
    } catch (error) {
      message.error(apiError(error, 'Не удалось загрузить рабочие места'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return workplaces.filter((item) => {
      if (branchId && item.branch_id !== branchId) return false
      if (departmentId && item.department_id !== departmentId) return false
      if (statusFilter && item.status !== statusFilter) return false
      if (!query) return true
      return [item.name, item.location, item.employee?.full_name, item.branch?.name, item.department?.name]
        .filter(Boolean).some((value) => value.toLowerCase().includes(query))
    })
  }, [workplaces, search, branchId, departmentId, statusFilter])

  const remove = async (id) => {
    try {
      await api.delete(`/workplaces/${id}`)
      message.success('Рабочее место удалено')
      load()
    } catch (error) {
      message.error(apiError(error, 'Не удалось удалить рабочее место'))
    }
  }

  const columns = [
    {
      title: 'Рабочее место', dataIndex: 'name', key: 'name',
      render: (value, item) => <Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/workplaces/${item.id}`)}>{value}</Button>,
    },
    { title: 'Сотрудник', key: 'employee', render: (_, item) => item.employee?.full_name || <Typography.Text type="secondary">Не назначен</Typography.Text> },
    { title: 'Филиал / отдел', key: 'org', render: (_, item) => [item.branch?.name, item.department?.name].filter(Boolean).join(' / ') || '—' },
    { title: 'Кабинет', dataIndex: 'location', key: 'location', render: (value) => value || '—' },
    { title: 'Оборудование', key: 'assets', width: 125, align: 'center', render: (_, item) => item.current_assets.length },
    {
      title: 'Статус', dataIndex: 'status', key: 'status', width: 130,
      render: (value) => <Tag color={WORKPLACE_STATUS[value]?.color}>{WORKPLACE_STATUS[value]?.label || value}</Tag>,
    },
    {
      title: '', key: 'actions', width: 190, fixed: 'right', align: 'right',
      render: (_, item) => <Space size={4}>
        <Button size="small" type="primary" onClick={() => navigate(`/workplaces/${item.id}`)}>Открыть</Button>
        <Button size="small" icon={<EditOutlined />} onClick={() => { setEditing(item); setModalOpen(true) }} />
        <Popconfirm title="Удалить рабочее место?" okText="Удалить" cancelText="Отмена" onConfirm={() => remove(item.id)}>
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      </Space>,
    },
  ]

  const availableDepartments = branchId
    ? departments.filter((item) => item.branch_id === branchId)
    : departments

  return <>
    <div className="page-toolbar" style={{ marginBottom: 18 }}>
      <Typography.Title level={3} style={{ margin: 0 }}>Рабочие места</Typography.Title>
      <Input.Search placeholder="Место, сотрудник, кабинет" allowClear value={search} onChange={(event) => setSearch(event.target.value)} style={{ width: 260 }} />
      <Select
        placeholder="Все филиалы" allowClear showSearch optionFilterProp="label" value={branchId}
        onChange={(value) => { setBranchId(value); setDepartmentId(undefined) }}
        options={branches.map((item) => ({ value: item.id, label: item.name }))} style={{ width: 180 }}
      />
      <Select
        placeholder="Все отделы" allowClear showSearch optionFilterProp="label" value={departmentId}
        onChange={setDepartmentId} options={availableDepartments.map((item) => ({ value: item.id, label: item.name }))}
        style={{ width: 180 }}
      />
      <Select
        placeholder="Все статусы" allowClear value={statusFilter} onChange={setStatusFilter}
        options={Object.entries(WORKPLACE_STATUS).map(([value, item]) => ({ value, label: item.label }))} style={{ width: 160 }}
      />
      <div className="toolbar-actions">
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); setModalOpen(true) }}>Добавить место</Button>
      </div>
    </div>
    <Table
      rowKey="id" dataSource={filtered} columns={columns} loading={loading} size="small"
      scroll={{ x: 'max-content' }} pagination={{ pageSize: 25, showTotal: (total) => `Рабочих мест: ${total}` }}
    />
    <WorkplaceModal
      open={modalOpen} editing={editing} branches={branches} departments={departments} employees={employees}
      onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); load() }}
    />
  </>
}
