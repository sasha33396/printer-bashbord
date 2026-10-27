import Table from '../../components/FilterableTable'
import { useCallback, useEffect, useState } from 'react'
import {
  Button, Col, Form, Input, Modal, Popconfirm, Row, Select,
  Space, Switch, Tag, Typography, message, Card, Descriptions, Avatar,
} from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import api from '../../api/api'
import KpiCards from '../../components/KpiCards'

const errorMessage = (error, fallback) => {
  const detail = error.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}

export default function EmployeesTab() {
  const [employees, setEmployees] = useState([])
  const [branches, setBranches] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const selected = employees.find((employee) => employee.id === selectedId)
  const [form] = Form.useForm()
  const branchId = Form.useWatch('branch_id', form)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [employeeResponse, branchResponse, departmentResponse] = await Promise.all([
        api.get('/employees'), api.get('/orgs/branches'), api.get('/orgs/departments'),
      ])
      setEmployees(employeeResponse.data)
      setBranches(branchResponse.data)
      setDepartments(departmentResponse.data)
    } catch (error) {
      message.error(errorMessage(error, 'Не удалось загрузить сотрудников'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ is_active: true })
    setOpen(true)
  }

  const openEdit = (employee) => {
    setEditing(employee)
    form.resetFields()
    form.setFieldsValue(employee)
    setOpen(true)
  }

  const save = async () => {
    const values = await form.validateFields()
    const payload = {
      ...values,
      ad_login: values.ad_login || null,
      ad_domain: values.ad_domain || null,
    }
    setSaving(true)
    try {
      if (editing) {
        await api.put(`/employees/${editing.id}`, payload)
        message.success('Сотрудник обновлён')
      } else {
        await api.post('/employees', payload)
        message.success('Сотрудник добавлен')
      }
      setOpen(false)
      load()
    } catch (error) {
      message.error(errorMessage(error, 'Не удалось сохранить сотрудника'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id) => {
    try {
      await api.delete(`/employees/${id}`)
      message.success('Сотрудник удалён')
      load()
    } catch (error) {
      message.error(errorMessage(error, 'Не удалось удалить сотрудника'))
    }
  }

  const availableDepartments = branchId
    ? departments.filter((item) => item.branch_id === branchId)
    : []

  const columns = [
    { title: 'ФИО', dataIndex: 'full_name', key: 'full_name' },
    {
      title: 'Логин AD', dataIndex: 'ad_login', key: 'ad_login',
      render: (value, item) => value ? <Space direction="vertical" size={0}>
        <span>{value}</span>
        {item.ad_domain && <Typography.Text type="secondary">{item.ad_domain}</Typography.Text>}
      </Space> : '—',
    },
    { title: 'Должность', dataIndex: 'position', key: 'position', render: (value) => value || '—' },
    {
      title: 'Филиал / отдел', key: 'location',
      render: (_, item) => [item.branch?.name, item.department?.name].filter(Boolean).join(' / ') || '—',
    },
    { title: 'Телефон', dataIndex: 'phone', key: 'phone', render: (value) => value || '—' },
    {
      title: 'Статус', dataIndex: 'is_active', key: 'is_active', width: 110,
      render: (active) => <Tag color={active ? 'green' : 'default'}>{active ? 'Работает' : 'Неактивен'}</Tag>,
    },
    {
      title: '', key: 'actions', width: 88, align: 'right',
      render: (_, item) => <Space size={4}>
        <Button size="small" icon={<EditOutlined />} title="Редактировать сотрудника" aria-label="Редактировать сотрудника" onClick={() => openEdit(item)} />
        <Popconfirm title="Удалить сотрудника?" okText="Удалить" cancelText="Отмена" onConfirm={() => remove(item.id)}>
          <Button size="small" danger icon={<DeleteOutlined />} title="Удалить сотрудника" aria-label="Удалить сотрудника" />
        </Popconfirm>
      </Space>,
    },
  ]

  return <>
    <KpiCards loading={loading} items={[
      { label: 'Сотрудники', value: employees.length },
      { label: 'Активные', value: employees.filter((row) => row.is_active).length, tone: 'green' },
      { label: 'Неактивные', value: employees.filter((row) => !row.is_active).length },
      { label: 'С логином AD', value: employees.filter((row) => row.ad_login).length },
    ]} />
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
      <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Добавить сотрудника</Button>
    </div>
    <div className={`repairs-grid${selected ? ' has-selection' : ''}`}>
    <div className="workspace-main"><Table searchable
      rowKey="id"
      dataSource={employees}
      columns={columns}
      loading={loading}
      rowClassName={(row) => selectedId === row.id ? 'selected-record-row' : ''}
      onRow={(row) => ({ onClick: (event) => { if (!event.target.closest('button,a,input')) setSelectedId(row.id) } })}
      scroll={{ x: 'max-content' }}
      pagination={{ defaultPageSize: 20, hideOnSinglePage: true }}
    /></div>
    {selected && <Card className="repair-detail" title="Информация о сотруднике" extra={<Button type="text" onClick={() => setSelectedId(null)}>Закрыть</Button>}>
      <Space align="start"><Avatar size={40} style={{ background: '#EFF6FF', color: '#2563EB' }}>{selected.full_name?.split(' ').slice(0, 2).map((part) => part[0]).join('')}</Avatar><div><strong>{selected.full_name}</strong><div style={{ marginTop: 6 }}><Tag color={selected.is_active ? 'green' : 'default'}>{selected.is_active ? 'Работает' : 'Неактивен'}</Tag></div></div></Space>
      <Descriptions className="employee-details" size="small" column={1} items={[
        { key: 'login', label: 'Логин AD', children: selected.ad_login || '—' },
        { key: 'domain', label: 'Домен AD', children: selected.ad_domain || '—' },
        { key: 'guid', label: 'GUID AD', children: selected.ad_guid || '—' },
        { key: 'email', label: 'Email', children: selected.email || '—' },
        { key: 'phone', label: 'Телефон', children: selected.phone || '—' },
        { key: 'branch', label: 'Филиал', children: selected.branch?.name || '—' },
        { key: 'department', label: 'Отдел', children: selected.department?.name || '—' },
        { key: 'position', label: 'Должность', children: selected.position || '—' },
        { key: 'notes', label: 'Примечание', children: selected.notes || '—' },
      ]} />
      <Button icon={<EditOutlined />} onClick={() => openEdit(selected)}>Редактировать</Button>
    </Card>}
    </div>
    <Modal
      title={editing ? 'Редактировать сотрудника' : 'Новый сотрудник'}
      open={open}
      onOk={save}
      onCancel={() => setOpen(false)}
      confirmLoading={saving}
      okText="Сохранить"
      cancelText="Отмена"
      width={680}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Row gutter={16}>
          <Col span={24}>
            <Form.Item name="full_name" label="ФИО" rules={[{ required: true, message: 'Укажите ФИО' }]}>
              <Input placeholder="Иванов Иван Иванович" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="ad_login" label="Логин AD"
              extra="Короткий логин пользователя, без домена"
              rules={[{
                pattern: /^[^\\@\s]*$/,
                transform: (value) => value?.trim(),
                message: 'Укажите логин без домена и пробелов',
              }]}
            >
              <Input placeholder="m.shutov" maxLength={255} allowClear />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="ad_domain" label="Домен AD">
              <Input placeholder="ruskon.local" maxLength={255} allowClear />
            </Form.Item>
          </Col>
          <Col span={12}><Form.Item name="position" label="Должность"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item name="phone" label="Телефон"><Input /></Form.Item></Col>
          <Col span={12}>
            <Form.Item name="branch_id" label="Филиал">
              <Select
                allowClear showSearch optionFilterProp="label"
                options={branches.map((item) => ({ value: item.id, label: item.name }))}
                onChange={() => form.setFieldValue('department_id', null)}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="department_id" label="Отдел">
              <Select
                allowClear showSearch optionFilterProp="label" disabled={!branchId}
                options={availableDepartments.map((item) => ({ value: item.id, label: item.name }))}
              />
            </Form.Item>
          </Col>
          <Col span={12}><Form.Item name="email" label="E-mail"><Input /></Form.Item></Col>
          <Col span={12}>
            <Form.Item name="is_active" label="Активный сотрудник" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Col>
          <Col span={24}><Form.Item name="notes" label="Примечание"><Input.TextArea rows={2} /></Form.Item></Col>
        </Row>
      </Form>
    </Modal>
  </>
}
