import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AutoComplete, Button, Col, DatePicker, Form, Input, InputNumber,
  Modal, Popconfirm, Row, Select, Space, Table, Tag, Typography, message,
} from 'antd'
import {
  DeleteOutlined, EditOutlined, HistoryOutlined, MinusOutlined, PlusOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import api from '../../api/api'

const MOVEMENT_CONFIG = {
  receipt: { label: 'Поступление', color: 'green', sign: '+' },
  issue:   { label: 'Выдача',      color: 'red',   sign: '−' },
}

const apiErrorMessage = (err, fallback) => {
  const detail = err.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map((item) => item.msg).filter(Boolean).join('; ') || fallback
  }
  return fallback
}

function ItemModal({ open, editing, categories, onClose, onSaved }) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    form.resetFields()
    if (editing) {
      form.setFieldsValue(editing)
    } else {
      form.setFieldsValue({ unit: 'шт.', min_quantity: 0, initial_quantity: 0 })
    }
  }, [open, editing, form])

  const handleSave = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      if (editing) {
        await api.put(`/warehouse/items/${editing.id}`, values)
        message.success('Позиция обновлена')
      } else {
        await api.post('/warehouse/items', values)
        message.success('Позиция добавлена на склад')
      }
      onSaved()
    } catch (err) {
      message.error(apiErrorMessage(err, 'Не удалось сохранить позицию'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={editing ? 'Редактировать позицию' : 'Новая позиция'}
      open={open}
      onOk={handleSave}
      onCancel={onClose}
      confirmLoading={saving}
      okText="Сохранить"
      cancelText="Отмена"
      width={620}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Row gutter={16}>
          <Col span={16}>
            <Form.Item name="name" label="Наименование" rules={[{ required: true, message: 'Введите наименование' }]}>
              <Input placeholder="Например: Картридж Kyocera TK-1170" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="sku" label="Артикул">
              <Input placeholder="TK-1170" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="category" label="Категория" rules={[{ required: true, message: 'Укажите категорию' }]}>
              <AutoComplete
                options={categories.map((value) => ({ value }))}
                placeholder="Картриджи, компьютеры…"
                filterOption={(input, option) => option.value.toLowerCase().includes(input.toLowerCase())}
              />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="unit" label="Единица" rules={[{ required: true }]}>
              <Input placeholder="шт." />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="min_quantity" label="Мин. остаток" rules={[{ required: true }]}>
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          {!editing && (
            <Col span={12}>
              <Form.Item name="initial_quantity" label="Начальный остаток" rules={[{ required: true }]}>
                <InputNumber min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          )}
          <Col span={24}>
            <Form.Item name="notes" label="Примечание">
              <Input.TextArea rows={2} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  )
}

function MovementModal({ open, item, movementType, onClose, onSaved }) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const config = MOVEMENT_CONFIG[movementType]

  useEffect(() => {
    if (!open) return
    form.resetFields()
    form.setFieldsValue({ date: dayjs(), quantity: 1 })
  }, [open, movementType, form])

  const handleSave = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      await api.post(`/warehouse/items/${item.id}/movements`, {
        ...values,
        movement_type: movementType,
        date: values.date.format('YYYY-MM-DD'),
      })
      message.success(movementType === 'receipt' ? 'Поступление сохранено' : 'Выдача сохранена')
      onSaved()
    } catch (err) {
      message.error(apiErrorMessage(err, 'Не удалось сохранить операцию'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`${config?.label}: ${item?.name ?? ''}`}
      open={open}
      onOk={handleSave}
      onCancel={onClose}
      confirmLoading={saving}
      okText="Сохранить"
      cancelText="Отмена"
      destroyOnClose
    >
      <Typography.Text type="secondary">
        Текущий остаток: {item?.current_quantity ?? 0} {item?.unit}
      </Typography.Text>
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="date" label="Дата" rules={[{ required: true }]}>
              <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="quantity" label={`Количество (${item?.unit ?? 'шт.'})`} rules={[{ required: true }]}>
              <InputNumber min={1} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item name="notes" label={movementType === 'issue' ? 'Кому / назначение' : 'Примечание'}>
              <Input.TextArea rows={2} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  )
}

function HistoryModal({ item, open, onClose, onChanged }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!item) return
    setLoading(true)
    try {
      const response = await api.get(`/warehouse/items/${item.id}/movements`)
      setData(response.data)
    } catch (err) {
      message.error(apiErrorMessage(err, 'Не удалось загрузить историю'))
    } finally {
      setLoading(false)
    }
  }, [item])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const remove = async (movementId) => {
    try {
      await api.delete(`/warehouse/movements/${movementId}`)
      message.success('Операция удалена')
      load()
      onChanged()
    } catch (err) {
      message.error(apiErrorMessage(err, 'Не удалось удалить операцию'))
    }
  }

  const columns = [
    { title: 'Дата', dataIndex: 'date', width: 115, render: (value) => dayjs(value).format('DD.MM.YYYY') },
    {
      title: 'Операция', dataIndex: 'movement_type', width: 130,
      render: (value) => <Tag color={MOVEMENT_CONFIG[value]?.color}>{MOVEMENT_CONFIG[value]?.label}</Tag>,
    },
    {
      title: 'Количество', key: 'quantity', width: 120, align: 'right',
      render: (_, row) => {
        const config = MOVEMENT_CONFIG[row.movement_type]
        return <Typography.Text type={row.movement_type === 'issue' ? 'danger' : 'success'}>
          {config?.sign}{row.quantity} {item?.unit}
        </Typography.Text>
      },
    },
    { title: 'Примечание', dataIndex: 'notes', render: (value) => value || '—' },
    {
      title: '', width: 45, align: 'right',
      render: (_, row) => (
        <Popconfirm title="Удалить операцию?" onConfirm={() => remove(row.id)} okText="Удалить" cancelText="Отмена">
          <Button icon={<DeleteOutlined />} size="small" danger />
        </Popconfirm>
      ),
    },
  ]

  return (
    <Modal
      title={`История: ${item?.name ?? ''}`}
      open={open}
      onCancel={onClose}
      footer={<Button onClick={onClose}>Закрыть</Button>}
      width={800}
      destroyOnClose
    >
      <Table
        rowKey="id"
        dataSource={data}
        columns={columns}
        loading={loading}
        size="small"
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
      />
    </Modal>
  )
}

export default function WarehousePage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState()
  const [itemModal, setItemModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [movement, setMovement] = useState(null)
  const [historyItem, setHistoryItem] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await api.get('/warehouse/items')
      setItems(response.data)
    } catch (err) {
      message.error(apiErrorMessage(err, 'Не удалось загрузить склад'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const categories = useMemo(
    () => [...new Set(items.map((item) => item.category))].sort((a, b) => a.localeCompare(b)),
    [items],
  )

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return items.filter((item) => {
      if (category && item.category !== category) return false
      if (!query) return true
      return [item.name, item.sku, item.category]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query))
    })
  }, [items, search, category])

  const removeItem = async (id) => {
    try {
      await api.delete(`/warehouse/items/${id}`)
      message.success('Позиция удалена')
      load()
    } catch (err) {
      message.error(apiErrorMessage(err, 'Не удалось удалить позицию'))
    }
  }

  const columns = [
    { title: 'Категория', dataIndex: 'category', width: 150 },
    { title: 'Артикул', dataIndex: 'sku', width: 120, render: (value) => value || '—' },
    { title: 'Наименование', dataIndex: 'name', ellipsis: true },
    {
      title: 'Остаток', key: 'current_quantity', width: 125, align: 'right',
      sorter: (a, b) => a.current_quantity - b.current_quantity,
      render: (_, row) => {
        const low = row.current_quantity <= row.min_quantity
        return <Tag color={low ? 'red' : 'green'}>{row.current_quantity} {row.unit}</Tag>
      },
    },
    {
      title: 'Мин. остаток', dataIndex: 'min_quantity', width: 125, align: 'right',
      render: (value, row) => `${value} ${row.unit}`,
    },
    {
      title: '', key: 'actions', width: 300, align: 'right', fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          <Button size="small" type="primary" icon={<PlusOutlined />}
            onClick={() => setMovement({ item: row, type: 'receipt' })}>
            Поступление
          </Button>
          <Button size="small" icon={<MinusOutlined />} disabled={row.current_quantity <= 0}
            onClick={() => setMovement({ item: row, type: 'issue' })}>
            Выдать
          </Button>
          <Button size="small" icon={<HistoryOutlined />} onClick={() => setHistoryItem(row)} />
          <Button size="small" icon={<EditOutlined />} onClick={() => { setEditing(row); setItemModal(true) }} />
          <Popconfirm title="Удалить позицию?" onConfirm={() => removeItem(row.id)} okText="Удалить" cancelText="Отмена">
            <Button size="small" icon={<DeleteOutlined />} danger />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Typography.Title level={3} style={{ margin: 0 }}>Склад</Typography.Title>
        <Input.Search
          placeholder="Поиск по названию или артикулу"
          allowClear
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          style={{ width: 280 }}
        />
        <Select
          placeholder="Все категории"
          allowClear
          value={category}
          onChange={setCategory}
          options={categories.map((value) => ({ value, label: value }))}
          style={{ width: 190 }}
        />
        <Button type="primary" icon={<PlusOutlined />} style={{ marginLeft: 'auto' }}
          onClick={() => { setEditing(null); setItemModal(true) }}>
          Добавить позицию
        </Button>
      </div>

      <Table
        rowKey="id"
        dataSource={filtered}
        columns={columns}
        loading={loading}
        size="small"
        scroll={{ x: 'max-content' }}
        pagination={{ pageSize: 25, showSizeChanger: true, showTotal: (total) => `Позиций: ${total}` }}
      />

      <ItemModal
        open={itemModal}
        editing={editing}
        categories={categories}
        onClose={() => setItemModal(false)}
        onSaved={() => { setItemModal(false); load() }}
      />
      <MovementModal
        open={!!movement}
        item={movement?.item}
        movementType={movement?.type}
        onClose={() => setMovement(null)}
        onSaved={() => { setMovement(null); load() }}
      />
      <HistoryModal
        open={!!historyItem}
        item={historyItem}
        onClose={() => setHistoryItem(null)}
        onChanged={load}
      />
    </>
  )
}
