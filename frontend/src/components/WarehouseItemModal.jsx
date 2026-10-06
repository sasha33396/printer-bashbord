import { useEffect, useState } from 'react'
import { AutoComplete, Col, Form, Input, InputNumber, Modal, Row, Select, message } from 'antd'
import api from '../api/api'

const DEFAULT_CATEGORIES = ['Картриджи', 'Мыши', 'Клавиатуры', 'Мониторы', 'Компьютеры', 'Ноутбуки', 'Телефоны', 'Принтеры']
const COMPUTER_CATEGORIES = new Set(['Компьютеры', 'Ноутбуки'])
const ASSET_CATEGORIES = new Set(['Мониторы', 'Компьютеры', 'Ноутбуки', 'Телефоны'])
const NETWORK_CATEGORIES = new Set(['Компьютеры', 'Ноутбуки', 'Телефоны'])
const PLACEMENTS = ['Склад/серверная', 'Ремонт/заправка', 'Рабочее место']
const CONDITIONS = ['На складе', 'Рабочий', 'В ремонте', 'Требует ремонта', 'Списан']

const apiErrorMessage = (err, fallback) => {
  const detail = err.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map((item) => item.msg).filter(Boolean).join('; ') || fallback
  }
  return fallback
}

export default function WarehouseItemModal({
  open, editing, initialCategory, categories = [], branches = [], departments = [],
  locationLocked = Boolean(editing?.workplace), onClose, onSaved,
}) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const selectedBranch = Form.useWatch('branch_id', form)
  const selectedCategory = Form.useWatch('category', form)
  const trackingType = Form.useWatch('tracking_type', form)
  const branchOptions = [...branches]
  if (editing?.branch && !branchOptions.some((item) => item.id === editing.branch.id)) branchOptions.push(editing.branch)
  const departmentOptions = [...departments]
  if (editing?.department && !departmentOptions.some((item) => item.id === editing.department.id)) departmentOptions.push(editing.department)
  const availableDepartments = departmentOptions.filter((item) => item.branch_id === selectedBranch)

  useEffect(() => {
    if (!open) return
    form.resetFields()
    if (editing) {
      form.setFieldsValue(editing)
    } else {
      form.setFieldsValue({
        unit: 'шт.', min_quantity: 0, initial_quantity: 0,
        tracking_type: 'quantity', placement: 'Склад/серверная', condition: 'На складе',
        category: initialCategory && initialCategory !== 'Принтеры' ? initialCategory : undefined,
      })
      if (ASSET_CATEGORIES.has(initialCategory)) form.setFieldValue('tracking_type', 'asset')
    }
  }, [open, editing, initialCategory, form])

  const handleSave = async () => {
    let values
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    if (locationLocked) {
      // Location is managed by the workplace; edits only update the asset card.
      delete values.branch_id
      delete values.department_id
      delete values.placement
    } else {
      values.department_id = values.department_id ?? null
      if (editing) values.branch_id = values.branch_id ?? null
    }
    if (values.tracking_type === 'asset') values.inventory_number = values.inventory_number?.trim() || null
    setSaving(true)
    try {
      if (editing) {
        await api.put(`/warehouse/items/${editing.id}`, values)
        message.success(values.inventory_number && values.inventory_number !== editing.inventory_number
          ? 'Позиция обновлена. Распечатайте новую этикетку'
          : 'Позиция обновлена')
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
      title={editing ? 'Редактировать оборудование' : 'Новая позиция'}
      open={open}
      onOk={handleSave}
      onCancel={() => { if (!saving) onClose() }}
      closable={!saving}
      maskClosable={!saving}
      cancelButtonProps={{ disabled: saving }}
      confirmLoading={saving}
      okText="Сохранить"
      cancelText="Отмена"
      width={820}
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
                options={[...new Set([...DEFAULT_CATEGORIES.filter((value) => value !== 'Принтеры'), ...categories])]
                  .map((value) => ({ value }))}
                placeholder="Картриджи, компьютеры…"
                filterOption={(input, option) => option.value.toLowerCase().includes(input.toLowerCase())}
                onChange={(value) => {
                  if (!editing) form.setFieldValue('tracking_type', ASSET_CATEGORIES.has(value) ? 'asset' : 'quantity')
                }}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="branch_id" label="Филиал / склад"
              rules={[{ required: !editing, message: 'Выберите филиал' }]}
              extra={locationLocked ? 'Задаётся рабочим местом' : undefined}
            >
              <Select
                disabled={locationLocked}
                allowClear={Boolean(editing)}
                showSearch
                optionFilterProp="label"
                options={branchOptions.map((item) => ({ value: item.id, label: item.name }))}
                placeholder={locationLocked ? 'Не указан' : 'Выберите филиал'}
                onChange={() => form.setFieldValue('department_id', null)}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="tracking_type" label="Способ учёта" rules={[{ required: true }]}>
              <Select disabled={!!editing} options={[
                { value: 'quantity', label: 'По количеству' },
                { value: 'asset', label: 'Поштучно, с инвентарным номером' },
              ]} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="placement" label="Местонахождение" rules={[{ required: true }]}>
              <Select disabled={locationLocked} options={PLACEMENTS.map((value) => ({ value, label: value }))} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="condition" label="Состояние" rules={[{ required: true }]}>
              <Select options={CONDITIONS.map((value) => ({ value, label: value }))} />
            </Form.Item>
          </Col>
          {trackingType === 'asset' && <>
            <Col span={12}>
              <Form.Item
                name="inventory_number"
                label="Инвентарный №"
                extra="Введите номер с наклейки. Можно заполнить позже"
                rules={[{ pattern: /^1-(?!00000)\d{5}$/, message: 'Формат номера: 1-00001' }]}
              >
                <Input placeholder="1-00001" allowClear />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="serial_number" label="Серийный №"><Input /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="manufacturer" label="Производитель"><Input /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="model" label="Модель"><Input /></Form.Item>
            </Col>
          </>}
          {selectedCategory === 'Картриджи' && (
            <Col span={24}>
              <Form.Item name="compatible_printers" label="Для каких принтеров">
                <Input placeholder="Например: Kyocera ECOSYS M2040dn" />
              </Form.Item>
            </Col>
          )}
          {selectedCategory === 'Мониторы' && <>
            <Col span={12}><Form.Item name="monitor_diagonal" label="Диагональ, дюймы"><InputNumber min={1} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="color" label="Цвет"><Input /></Form.Item></Col>
          </>}
          {NETWORK_CATEGORIES.has(selectedCategory) && <>
            <Col span={12}>
              <Form.Item name="ip_address" label="IP-адрес">
                <Input placeholder="172.16.51.73" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="mac_address"
                label="MAC-адрес"
                rules={[{
                  pattern: /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$|^[0-9A-Fa-f]{12}$|^[0-9A-Fa-f]{4}(\.[0-9A-Fa-f]{4}){2}$/,
                  message: 'Формат: AA:BB:CC:DD:EE:FF',
                }]}
              >
                <Input placeholder="AA:BB:CC:DD:EE:FF" />
              </Form.Item>
            </Col>
          </>}
          {COMPUTER_CATEGORIES.has(selectedCategory) && <>
            <Col span={8}><Form.Item name="ram_gb" label="ОЗУ, ГБ"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={16}><Form.Item name="processor" label="Процессор"><Input /></Form.Item></Col>
            <Col span={24}><Form.Item name="graphics" label="Видеокарта"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="storage_type" label="Накопитель"><Select allowClear options={['SSD', 'HDD', 'HDD/SSD'].map((value) => ({ value }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="storage_capacity_gb" label="Объём, ГБ"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="os_name" label="Операционная система"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="os_version" label="Версия ОС"><Input /></Form.Item></Col>
          </>}
          <Col span={12}>
            <Form.Item name="department_id" label="Отдел">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                disabled={locationLocked || !selectedBranch}
                options={availableDepartments.map((item) => ({ value: item.id, label: item.name }))}
                placeholder="Выберите отдел"
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
          {!editing && trackingType !== 'asset' && (
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

