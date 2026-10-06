import DeviceModal from '../../components/DeviceModal'
import Table from '../../components/FilterableTable'
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button, Space, Tag, Select, Popconfirm, Modal,
  Upload, Typography, message, List,
} from 'antd'
import {
  PlusOutlined, UploadOutlined, DownloadOutlined,
  EditOutlined, DeleteOutlined, EyeOutlined, CopyOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import * as XLSX from 'xlsx'
import api from '../../api/api'
import { copyText, deviceWebUrl } from '../../utils/network'

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
      width: 190,
      render: (v) => v ? (
        <Space className="device-ip-value" size={4}>
          <a
            href={deviceWebUrl(v)}
            target="_blank"
            rel="noreferrer noopener"
            title="Открыть веб-интерфейс принтера"
          >
            {v}
          </a>
          <Button
            type="text"
            size="small"
            icon={<CopyOutlined />}
            title="Скопировать IP-адрес"
            aria-label="Скопировать IP-адрес"
            onClick={async () => {
              try {
                await copyText(v)
                message.success('IP-адрес скопирован')
              } catch {
                message.error('Не удалось скопировать IP-адрес')
              }
            }}
          />
        </Space>
      ) : <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'Инв.№',
      dataIndex: 'inventory_number',
      key: 'inventory_number',
      width: 130,
      render: (value) => value || '—',
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
      <div className="page-toolbar" style={{ marginBottom: 16 }}>
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

        <div className="toolbar-actions">
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
        scroll={{ x: 'max-content' }}
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
