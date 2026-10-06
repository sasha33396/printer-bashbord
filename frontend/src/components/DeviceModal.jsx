import { useState, useEffect, useRef } from 'react'
import { Button, Col, DatePicker, Divider, Form, Input, Modal, Row, Select, Space, message } from 'antd'
import dayjs from 'dayjs'
import { PlusOutlined } from '@ant-design/icons'
import api from '../api/api'

const TYPE_OPTIONS = [
  { value: 'printer', label: 'Принтер' }, { value: 'mfc', label: 'МФУ' },
  { value: 'plotter', label: 'Плоттер' }, { value: 'scanner', label: 'Сканер' },
]
const STATUS_OPTIONS = [
  { value: 'active', label: 'Активен' }, { value: 'repair', label: 'В ремонте' },
  { value: 'decommissioned', label: 'Списан' },
]

const toDayjs = (v) => (v ? dayjs(v) : null)
const fromDayjs = (v) => (v ? v.format('YYYY-MM-DD') : null)

// ---------------------------------------------------------------------------
// DeviceModal — create / edit
// ---------------------------------------------------------------------------

export default function DeviceModal({ open, editing, branches, departments, manufacturers, onManufacturerAdded, onClose, onSaved }) {
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
    let raw
    try { raw = await form.validateFields() } catch { return }
    const payload = {
      ...raw,
      inventory_number: raw.inventory_number?.trim() || null,
      ip_address: raw.ip_address?.trim() || null,
      purchase_date:  fromDayjs(raw.purchase_date),
      warranty_until: fromDayjs(raw.warranty_until),
    }
    setSaving(true)
    try {
      if (editing) {
        await api.put(`/devices/${editing.id}`, payload)
        message.success(payload.inventory_number && payload.inventory_number !== editing.inventory_number
          ? 'Устройство обновлено. Распечатайте новую этикетку'
          : 'Устройство обновлено')
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
      onCancel={() => { if (!saving) onClose() }}
      closable={!saving}
      maskClosable={!saving}
      cancelButtonProps={{ disabled: saving }}
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
              extra="Введите номер с наклейки. Можно заполнить позже"
              rules={[{ pattern: /^1-(?!00000)\d{5}$/, message: 'Формат номера: 1-00001' }]}
            >
              <Input placeholder="1-00001" allowClear />
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
