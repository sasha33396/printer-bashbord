import { useEffect, useState } from 'react'
import { Alert, AutoComplete, Button, Form, Modal, Space, Typography, message } from 'antd'
import api from '../api/api'
import { normalizedModel } from '../utils/cartridges'

export default function CartridgeCompatibilityModal({ open, initialModel, items, devices, onClose, onSaved }) {
  const [form] = Form.useForm()
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const links = Form.useWatch('devices', form)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    form.resetFields()
    setLoading(true)
    api.get('/cartridges/compatibility').then(({ data }) => {
      if (cancelled) return
      setProfiles(data)
      form.setFieldsValue({ cartridge_model: initialModel || '',
        devices: data.find((row) => normalizedModel(row.cartridge_model) === normalizedModel(initialModel))?.devices || [] })
    }).catch(() => { if (!cancelled) message.error('Не удалось загрузить совместимость') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, initialModel, form])
  const save = async () => {
    let values
    try { values = await form.validateFields() } catch { return }
    setSaving(true)
    try {
      await api.put('/cartridges/compatibility', { ...values, devices: values.devices || [] })
      message.success('Совместимость сохранена')
      onSaved()
    } catch (error) {
      const detail = error.response?.data?.detail
      message.error(typeof detail === 'string' ? detail : 'Не удалось сохранить совместимость')
    } finally { setSaving(false) }
  }
  const models = [...new Set([...items.map((item) => item.name), ...profiles.map((row) => row.cartridge_model)])]
  const manufacturers = [...new Set(devices.map((device) => device.manufacturer))]
  return <Modal open={open} title="Справочник совместимости" onCancel={() => { if (!saving) onClose() }}
    onOk={save} confirmLoading={saving} okButtonProps={{ disabled: loading }} okText="Сохранить" cancelText="Отмена" width={720} destroyOnClose>
    <Alert type="info" showIcon style={{ marginBottom: 16 }} message="Настройка применяется ко всем картриджам с этим наименованием."
      description="Укажите совместимые модели принтеров. Если список пуст, совместимость остаётся неизвестной. Старое текстовое описание сохраняется отдельно." />
    <Form form={form} layout="vertical" disabled={loading || saving}>
      <Form.Item name="cartridge_model" label="Модель / наименование картриджа" rules={[{ required: true, whitespace: true }]}>
        <AutoComplete options={models.map((value) => ({ value }))} filterOption={(input, option) => normalizedModel(option.value).includes(normalizedModel(input))}
          maxLength={255} onChange={(value) => form.setFieldValue('devices',
            profiles.find((row) => normalizedModel(row.cartridge_model) === normalizedModel(value))?.devices || [])} />
      </Form.Item>
      <Typography.Title level={5}>Совместимые принтеры</Typography.Title>
      <Form.List name="devices">{(fields, { add, remove }) => <>
        {fields.map((field) => <Space key={field.key} align="start" wrap>
          <Form.Item name={[field.name, 'manufacturer']} label="Производитель" rules={[{ required: true, whitespace: true }]}>
            <AutoComplete style={{ width: 200 }} maxLength={255} options={manufacturers.map((value) => ({ value }))} />
          </Form.Item>
          <Form.Item name={[field.name, 'model']} label="Модель принтера" rules={[{ required: true, whitespace: true }]}>
            <AutoComplete style={{ width: 290 }} maxLength={255} options={[...new Set(devices
              .filter((device) => normalizedModel(device.manufacturer) === normalizedModel(links?.[field.name]?.manufacturer))
              .map((device) => device.model))].map((value) => ({ value }))} />
          </Form.Item>
          <Button style={{ marginTop: 30 }} onClick={() => remove(field.name)}>Убрать</Button>
        </Space>)}
        <Button onClick={() => add({ manufacturer: '', model: '' })}>Добавить модель принтера</Button>
      </>}</Form.List>
    </Form>
  </Modal>
}
