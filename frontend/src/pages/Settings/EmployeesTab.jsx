import { useCallback, useEffect, useState } from 'react'
import {
  Button, Col, Form, Input, Modal, Popconfirm, Row, Select,
  Space, Switch, Table, Tag, Typography, message,
} from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import api from '../../api/api'

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
    setSaving(true)
    try {
      if (editing) {
        await api.put(`/employees/${editing.id}`, values)
        message.success('Сотрудник обновлён')
      } else {
        await api.post('/employees', values)
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
        <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(item)} />
        <Popconfirm title="Удалить сотрудника?" okText="Удалить" cancelText="Отмена" onConfirm={() => remove(item.id)}>
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      </Space>,
    },
  ]

  return <>
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
      <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Добавить сотрудника</Button>
    </div>
    <Table
      rowKey="id"
      dataSource={employees}
      columns={columns}
      loading={loading}
      scroll={{ x: 'max-content' }}
      pagination={{ pageSize: 20, hideOnSinglePage: true }}
    />
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
