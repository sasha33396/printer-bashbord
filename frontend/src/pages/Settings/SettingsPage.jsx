import { useState, useEffect, useCallback } from 'react'
import {
  Tabs, Table, Button, Modal, Form, Input, Select,
  Popconfirm, Space, message, Typography,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import api from '../../api/api'
import EmployeesTab from './EmployeesTab'

// ---------------------------------------------------------------------------
// BranchesTab
// ---------------------------------------------------------------------------

function BranchesTab() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/orgs/branches')
      setData(res.data)
    } catch {
      message.error('Не удалось загрузить филиалы')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    form.resetFields()
    setEditing(null)
    setModalOpen(true)
  }

  const openEdit = (record) => {
    form.setFieldsValue({ name: record.name, address: record.address })
    setEditing(record)
    setModalOpen(true)
  }

  const handleSave = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      if (editing) {
        await api.put(`/orgs/branches/${editing.id}`, values)
        message.success('Филиал обновлён')
      } else {
        await api.post('/orgs/branches', values)
        message.success('Филиал добавлен')
      }
      setModalOpen(false)
      load()
    } catch {
      message.error('Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    try {
      await api.delete(`/orgs/branches/${id}`)
      message.success('Филиал удалён')
      load()
    } catch {
      message.error('Ошибка удаления')
    }
  }

  const columns = [
    { title: 'Название', dataIndex: 'name', key: 'name' },
    {
      title: 'Адрес',
      dataIndex: 'address',
      key: 'address',
      render: (v) => v || <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: '',
      key: 'actions',
      width: 88,
      align: 'right',
      render: (_, record) => (
        <Space size={4}>
          <Button
            icon={<EditOutlined />}
            size="small"
            onClick={() => openEdit(record)}
          />
          <Popconfirm
            title="Удалить филиал?"
            description="Отделы этого филиала останутся без привязки."
            onConfirm={() => handleDelete(record.id)}
            okText="Удалить"
            cancelText="Отмена"
            okButtonProps={{ danger: true }}
          >
            <Button icon={<DeleteOutlined />} size="small" danger />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Добавить
        </Button>
      </div>

      <Table
        rowKey="id"
        dataSource={data}
        columns={columns}
        loading={loading}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
      />

      <Modal
        title={editing ? 'Редактировать филиал' : 'Новый филиал'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        okText="Сохранить"
        cancelText="Отмена"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="Название"
            rules={[{ required: true, message: 'Введите название' }]}
          >
            <Input placeholder="Например: Головной офис" />
          </Form.Item>
          <Form.Item name="address" label="Адрес">
            <Input placeholder="Город, улица, дом" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

// ---------------------------------------------------------------------------
// DepartmentsTab
// ---------------------------------------------------------------------------

function DepartmentsTab() {
  const [data, setData] = useState([])
  const [branches, setBranches] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [depts, brs] = await Promise.all([
        api.get('/orgs/departments'),
        api.get('/orgs/branches'),
      ])
      setData(depts.data)
      setBranches(brs.data)
    } catch {
      message.error('Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    form.resetFields()
    setEditing(null)
    setModalOpen(true)
  }

  const openEdit = (record) => {
    form.setFieldsValue({ name: record.name, branch_id: record.branch_id ?? undefined })
    setEditing(record)
    setModalOpen(true)
  }

  const handleSave = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      if (editing) {
        await api.put(`/orgs/departments/${editing.id}`, values)
        message.success('Отдел обновлён')
      } else {
        await api.post('/orgs/departments', values)
        message.success('Отдел добавлен')
      }
      setModalOpen(false)
      load()
    } catch {
      message.error('Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    try {
      await api.delete(`/orgs/departments/${id}`)
      message.success('Отдел удалён')
      load()
    } catch {
      message.error('Ошибка удаления')
    }
  }

  const branchOptions = branches.map((b) => ({ value: b.id, label: b.name }))

  const columns = [
    { title: 'Название', dataIndex: 'name', key: 'name' },
    {
      title: 'Филиал',
      key: 'branch',
      render: (_, r) =>
        r.branch?.name ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: '',
      key: 'actions',
      width: 88,
      align: 'right',
      render: (_, record) => (
        <Space size={4}>
          <Button
            icon={<EditOutlined />}
            size="small"
            onClick={() => openEdit(record)}
          />
          <Popconfirm
            title="Удалить отдел?"
            onConfirm={() => handleDelete(record.id)}
            okText="Удалить"
            cancelText="Отмена"
            okButtonProps={{ danger: true }}
          >
            <Button icon={<DeleteOutlined />} size="small" danger />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Добавить
        </Button>
      </div>

      <Table
        rowKey="id"
        dataSource={data}
        columns={columns}
        loading={loading}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
      />

      <Modal
        title={editing ? 'Редактировать отдел' : 'Новый отдел'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        okText="Сохранить"
        cancelText="Отмена"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="Название"
            rules={[{ required: true, message: 'Введите название' }]}
          >
            <Input placeholder="Например: Бухгалтерия" />
          </Form.Item>
          <Form.Item name="branch_id" label="Филиал">
            <Select
              options={branchOptions}
              placeholder="Выберите филиал"
              allowClear
              showSearch
              optionFilterProp="label"
              notFoundContent="Нет филиалов"
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

// ---------------------------------------------------------------------------
// ManufacturersTab
// ---------------------------------------------------------------------------

function ManufacturersTab() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/manufacturers')
      setData(res.data)
    } catch {
      message.error('Не удалось загрузить производителей')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    form.resetFields()
    setModalOpen(true)
  }

  const handleSave = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      await api.post('/manufacturers', values)
      message.success('Производитель добавлен')
      setModalOpen(false)
      load()
    } catch (err) {
      const detail = err.response?.data?.detail
      message.error(typeof detail === 'string' ? detail : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    try {
      await api.delete(`/manufacturers/${id}`)
      message.success('Производитель удалён')
      load()
    } catch {
      message.error('Ошибка удаления')
    }
  }

  const columns = [
    { title: 'Название', dataIndex: 'name', key: 'name' },
    {
      title: '',
      key: 'actions',
      width: 60,
      align: 'right',
      render: (_, record) => (
        <Popconfirm
          title="Удалить производителя?"
          onConfirm={() => handleDelete(record.id)}
          okText="Удалить"
          cancelText="Отмена"
          okButtonProps={{ danger: true }}
        >
          <Button icon={<DeleteOutlined />} size="small" danger />
        </Popconfirm>
      ),
    },
  ]

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Добавить
        </Button>
      </div>

      <Table
        rowKey="id"
        dataSource={data}
        columns={columns}
        loading={loading}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
      />

      <Modal
        title="Новый производитель"
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        okText="Сохранить"
        cancelText="Отмена"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="Название"
            rules={[{ required: true, message: 'Введите название' }]}
          >
            <Input placeholder="Например: Kyocera" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

// ---------------------------------------------------------------------------
// SettingsPage
// ---------------------------------------------------------------------------

const TABS = [
  { key: 'branches',      label: 'Филиалы',       children: <BranchesTab /> },
  { key: 'departments',   label: 'Отделы',         children: <DepartmentsTab /> },
  { key: 'employees',     label: 'Сотрудники',      children: <EmployeesTab /> },
  { key: 'manufacturers', label: 'Производители',  children: <ManufacturersTab /> },
]

export default function SettingsPage() {
  return (
    <>
      <Typography.Title level={3} style={{ marginTop: 0 }}>Справочники</Typography.Title>
      <Tabs items={TABS} destroyInactiveTabPane />
    </>
  )
}
