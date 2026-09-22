import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Table, Button, Space, Tag, Select, Popconfirm, Modal,
  Form, Input, DatePicker, Upload, Typography, message, Row, Col, List, Divider,
} from 'antd'
import {
  PlusOutlined, UploadOutlined, DownloadOutlined,
  EditOutlined, DeleteOutlined, EyeOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import * as XLSX from 'xlsx'
import api from '../../api/api'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPE_LABELS = {
  printer: 'Принтер',
  mfc:     'МФУ',
  plotter: 'Плоттер',
  scanner: 'Сканер',
}

const STATUS_CONFIG = {
  active:         { color: 'green',  label: 'Активен'   },
  repair:         { color: 'orange', label: 'В ремонте'  },
  decommissioned: { color: 'red',    label: 'Списан'     },
}

const TYPE_OPTIONS   = Object.entries(TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))
const STATUS_OPTIONS = Object.entries(STATUS_CONFIG).map(([v, c]) => ({ value: v, label: c.label }))

const TEMPLATE_COLS = [
  'Инв.номер', 'Серийный номер', 'Производитель', 'Модель', 'Тип',
  'Филиал', 'Отдел', 'Кабинет', 'Дата покупки', 'Гарантия до', 'Статус', 'Примечание',
  'IP-адрес',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_COLS])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Устройства')
  XLSX.writeFile(wb, 'devices_template.xlsx')
}

const toDayjs = (v) => (v ? dayjs(v) : null)
const fromDayjs = (v) => (v ? v.format('YYYY-MM-DD') : null)

// ---------------------------------------------------------------------------
// DeviceModal — create / edit
// ---------------------------------------------------------------------------

function DeviceModal({ open, editing, branches, departments, manufacturers, onManufacturerAdded, onClose, onSaved }) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [newMfrName, setNewMfrName] = useState('')
  const [addingMfr, setAddingMfr] = useState(false)
  const mfrInputRef = useRef(null)

  const handleAddManufacturer = async () => {
    const name = newMfrName.trim()
    if (!name) return
    setAddingMfr(true)
    try {
      const res = await api.post('/manufacturers', { name })
      onManufacturerAdded(res.data)
      form.setFieldValue('manufacturer', res.data.name)
      setNewMfrName('')
    } catch (err) {
      const detail = err.response?.data?.detail
      message.error(typeof detail === 'string' ? detail : 'Ошибка добавления')
    } finally {
      setAddingMfr(false)
    }
  }

  useEffect(() => {
    if (!open) return
    if (editing) {
      form.setFieldsValue({
        ...editing,
        department_id:  editing.department_id ?? undefined,
        purchase_date:  toDayjs(editing.purchase_date),
        warranty_until: toDayjs(editing.warranty_until),
      })
    } else {
      form.resetFields()
      form.setFieldValue('status', 'active')
    }
  }, [open, editing, form])

  const handleSave = async () => {
    const raw = await form.validateFields()
    const payload = {
      ...raw,
      ip_address: raw.ip_address?.trim() || null,
      purchase_date:  fromDayjs(raw.purchase_date),
      warranty_until: fromDayjs(raw.warranty_until),
    }
    setSaving(true)
    try {
      if (editing) {
        await api.put(`/devices/${editing.id}`, payload)
        message.success('Устройство обновлено')
      } else {
        await api.post('/devices', payload)
        message.success('Устройство добавлено')
      }
      onSaved()
    } catch (err) {
      const detail = err.response?.data?.detail
      message.error(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((e) => e.msg).join('; ') : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  // Department options grouped by branch
  const deptOptions = [
    ...branches
      .map((b) => ({
        label: b.name,
        options: departments
          .filter((d) => d.branch_id === b.id)
          .map((d) => ({ value: d.id, label: d.name })),
      }))
      .filter((g) => g.options.length > 0),
    ...(departments.filter((d) => !d.branch_id).length
      ? [{
          label: 'Без филиала',
          options: departments
            .filter((d) => !d.branch_id)
            .map((d) => ({ value: d.id, label: d.name })),
        }]
      : []),
  ]

  return (
    <Modal
      title={editing ? 'Редактировать устройство' : 'Новое устройство'}
      open={open}
      onOk={handleSave}
      onCancel={onClose}
      confirmLoading={saving}
      okText="Сохранить"
      cancelText="Отмена"
      width={660}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="inventory_number"
              label="Инв. номер"
              rules={[{ required: true, message: 'Обязательное поле' }]}
            >
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="serial_number" label="Серийный номер">
              <Input />
            </Form.Item>
          </Col>

          <Col span={12}>
            <Form.Item
              name="manufacturer"
              label="Производитель"
              rules={[{ required: true, message: 'Обязательное поле' }]}
            >
              <Select
                showSearch
                placeholder="Выберите производителя"
                optionFilterProp="label"
                options={manufacturers.map((m) => ({ value: m.name, label: m.name }))}
                dropdownRender={(menu) => (
                  <>
                    {menu}
                    <Divider style={{ margin: '8px 0' }} />
                    <Space style={{ padding: '0 8px 4px' }}>
                      <Input
                        ref={mfrInputRef}
                        placeholder="Новый производитель"
                        value={newMfrName}
                        onChange={(e) => setNewMfrName(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                        onPressEnter={handleAddManufacturer}
                        style={{ width: 180 }}
                      />
                      <Button
                        type="text"
                        icon={<PlusOutlined />}
                        loading={addingMfr}
                        onClick={handleAddManufacturer}
                      >
                        Добавить
                      </Button>
                    </Space>
                  </>
                )}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="model"
              label="Модель"
              rules={[{ required: true, message: 'Обязательное поле' }]}
            >
              <Input />
            </Form.Item>
          </Col>

          <Col span={12}>
            <Form.Item
              name="device_type"
              label="Тип"
              rules={[{ required: true, message: 'Обязательное поле' }]}
            >
              <Select options={TYPE_OPTIONS} placeholder="Выберите тип" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="status"
              label="Статус"
              rules={[{ required: true, message: 'Обязательное поле' }]}
            >
              <Select options={STATUS_OPTIONS} />
            </Form.Item>
          </Col>

          <Col span={12}>
            <Form.Item name="department_id" label="Отдел">
              <Select
                options={deptOptions}
                placeholder="Выберите отдел"
                allowClear
                showSearch
                optionFilterProp="label"
                notFoundContent="Нет отделов"
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="location" label="Кабинет">
              <Input placeholder="Например: 204" />
            </Form.Item>
          </Col>

          <Col span={12}>
            <Form.Item name="purchase_date" label="Дата покупки">
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="warranty_until" label="Гарантия до">
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
          </Col>

          <Col span={12}>
            <Form.Item name="ip_address" label="IP-адрес">
              <Input placeholder="Например: 192.168.1.100" allowClear />
            </Form.Item>
          </Col>
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

// ---------------------------------------------------------------------------
// DevicesPage
// ---------------------------------------------------------------------------

export default function DevicesPage() {
  const navigate = useNavigate()

  const [devices,       setDevices]       = useState([])
  const [branches,      setBranches]      = useState([])
  const [allDepts,      setAllDepts]      = useState([])
  const [manufacturers, setManufacturers] = useState([])
  const [loading,       setLoading]       = useState(false)
  const [dictsLoading,  setDictsLoading]  = useState(false)
  const [importing,    setImporting]    = useState(false)
  const [filters,      setFilters]      = useState({})
  const [modalOpen,    setModalOpen]    = useState(false)
  const [editing,      setEditing]      = useState(null)
  const [importResult, setImportResult] = useState(null)

  // Load branch + dept + manufacturer dictionaries once
  useEffect(() => {
    setDictsLoading(true)
    Promise.all([
      api.get('/orgs/branches'),
      api.get('/orgs/departments'),
      api.get('/manufacturers'),
    ])
      .then(([bRes, dRes, mRes]) => {
        setBranches(bRes.data)
        setAllDepts(dRes.data)
        setManufacturers(mRes.data)
      })
      .catch(() => message.error('Не удалось загрузить справочники'))
      .finally(() => setDictsLoading(false))
  }, [])

  const loadDevices = useCallback(async (f) => {
    setLoading(true)
    try {
      const params = Object.fromEntries(
        Object.entries(f ?? filters).filter(([, v]) => v != null),
      )
      const res = await api.get('/devices', { params })
      setDevices(res.data)
    } catch {
      message.error('Не удалось загрузить устройства')
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { loadDevices() }, [loadDevices])

  // ---- Filters ----

  const handleFilterChange = (key, value) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value ?? undefined }
      if (key === 'branch_id') next.department_id = undefined
      return next
    })
  }

  const deptFilterOptions = filters.branch_id
    ? allDepts.filter((d) => d.branch_id === filters.branch_id)
    : allDepts

  // ---- CRUD ----

  const openCreate = () => { setEditing(null); setModalOpen(true) }
  const openEdit   = (r)  => { setEditing(r);   setModalOpen(true) }

  const handleDelete = async (id) => {
    try {
      await api.delete(`/devices/${id}`)
      message.success('Устройство удалено')
      loadDevices()
    } catch {
      message.error('Ошибка удаления')
    }
  }

  // ---- Import ----

  const handleImport = (file) => {
    setImporting(true)
    const fd = new FormData()
    fd.append('file', file)
    api.post('/devices/import', fd)
      .then(({ data }) => { setImportResult(data); loadDevices() })
      .catch((err) => message.error(err.response?.data?.detail ?? 'Ошибка импорта'))
      .finally(() => setImporting(false))
    return false // prevent Upload default behaviour
  }

  // ---- Columns ----

  const columns = [
    {
      title: 'IP-адрес',
      dataIndex: 'ip_address',
      key: 'ip_address',
      width: 160,
      render: (v) => v || <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'Инв.№',
      dataIndex: 'inventory_number',
      key: 'inventory_number',
      width: 130,
    },
    {
      title: 'Модель',
      key: 'model',
      render: (_, r) => `${r.manufacturer} ${r.model}`,
    },
    {
      title: 'Тип',
      dataIndex: 'device_type',
      key: 'device_type',
      width: 90,
      render: (v) => TYPE_LABELS[v] ?? v,
    },
    {
      title: 'Филиал / Отдел',
      key: 'org',
      ellipsis: true,
      render: (_, r) => {
        const branch = r.department?.branch?.name
        const dept   = r.department?.name
        if (!branch && !dept) return <Typography.Text type="secondary">—</Typography.Text>
        return branch ? `${branch} / ${dept}` : dept
      },
    },
    {
      title: 'Кабинет',
      dataIndex: 'location',
      key: 'location',
      width: 90,
      render: (v) => v ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (v) => {
        const cfg = STATUS_CONFIG[v] ?? { color: 'default', label: v }
        return <Tag color={cfg.color}>{cfg.label}</Tag>
      },
    },
    {
      title: 'Гарантия до',
      dataIndex: 'warranty_until',
      key: 'warranty_until',
      width: 120,
      render: (v) => {
        if (!v) return <Typography.Text type="secondary">—</Typography.Text>
        const expired = dayjs().isAfter(dayjs(v))
        return (
          <span style={{ color: expired ? '#ff4d4f' : undefined }}>
            {dayjs(v).format('DD.MM.YYYY')}
          </span>
        )
      },
    },
    {
      title: '',
      key: 'actions',
      width: 112,
      align: 'right',
      render: (_, record) => (
        <Space size={4}>
          <Button
            icon={<EyeOutlined />}
            size="small"
            onClick={() => navigate(`/devices/${record.id}`)}
          />
          <Button
            icon={<EditOutlined />}
            size="small"
            onClick={() => openEdit(record)}
          />
          <Popconfirm
            title="Удалить устройство?"
            description="Все ремонты и расходники будут удалены."
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

  // ---- Render ----

  return (
    <>
      <Typography.Title level={3} style={{ marginTop: 0 }}>Устройства</Typography.Title>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        <Select
          style={{ width: 176 }}
          placeholder="Все филиалы"
          options={branches.map((b) => ({ value: b.id, label: b.name }))}
          value={filters.branch_id}
          onChange={(v) => handleFilterChange('branch_id', v)}
          loading={dictsLoading}
          allowClear
        />
        <Select
          style={{ width: 196 }}
          placeholder="Все отделы"
          options={deptFilterOptions.map((d) => ({ value: d.id, label: d.name }))}
          value={filters.department_id}
          onChange={(v) => handleFilterChange('department_id', v)}
          loading={dictsLoading}
          allowClear
        />
        <Select
          style={{ width: 176 }}
          placeholder="Все производители"
          options={manufacturers.map((m) => ({ value: m.name, label: m.name }))}
          value={filters.manufacturer}
          onChange={(v) => handleFilterChange('manufacturer', v)}
          loading={dictsLoading}
          showSearch
          allowClear
        />
        <Select
          style={{ width: 136 }}
          placeholder="Все типы"
          options={TYPE_OPTIONS}
          value={filters.device_type}
          onChange={(v) => handleFilterChange('device_type', v)}
          allowClear
        />
        <Select
          style={{ width: 136 }}
          placeholder="Все статусы"
          options={STATUS_OPTIONS}
          value={filters.status}
          onChange={(v) => handleFilterChange('status', v)}
          allowClear
        />

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>
            Скачать шаблон
          </Button>
          <Upload accept=".xlsx,.xlsm" showUploadList={false} beforeUpload={handleImport}>
            <Button icon={<UploadOutlined />} loading={importing}>
              Импорт Excel
            </Button>
          </Upload>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Добавить устройство
          </Button>
        </div>
      </div>

      {/* Table */}
      <Table
        rowKey="id"
        dataSource={devices}
        columns={columns}
        loading={loading}
        size="small"
        pagination={{
          pageSize: 25,
          showSizeChanger: true,
          showTotal: (total) => `Всего: ${total}`,
        }}
      />

      {/* Add / Edit modal */}
      <DeviceModal
        open={modalOpen}
        editing={editing}
        branches={branches}
        departments={allDepts}
        manufacturers={manufacturers}
        onManufacturerAdded={(m) => setManufacturers((prev) => [...prev, m].sort((a, b) => a.name.localeCompare(b.name)))}
        onClose={() => setModalOpen(false)}
        onSaved={() => { setModalOpen(false); loadDevices() }}
      />

      {/* Import result modal */}
      <Modal
        title="Результат импорта"
        open={!!importResult}
        onOk={() => setImportResult(null)}
        onCancel={() => setImportResult(null)}
        okText="Закрыть"
        cancelButtonProps={{ style: { display: 'none' } }}
      >
        {importResult && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <div>
              Создано: <strong>{importResult.created}</strong>
              {'  '}
              Пропущено: <strong>{importResult.skipped}</strong>
            </div>
            {importResult.errors.length > 0 && (
              <List
                header={<Typography.Text type="danger">Ошибки ({importResult.errors.length})</Typography.Text>}
                size="small"
                dataSource={importResult.errors}
                style={{ maxHeight: 240, overflowY: 'auto' }}
                renderItem={(e) => (
                  <List.Item style={{ padding: '4px 0' }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{e}</Typography.Text>
                  </List.Item>
                )}
              />
            )}
          </Space>
        )}
      </Modal>
    </>
  )
}
