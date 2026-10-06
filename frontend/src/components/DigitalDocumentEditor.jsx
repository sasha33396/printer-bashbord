import { useEffect, useState } from 'react'
import { Col, DatePicker, Form, Input, Modal, Row, message } from 'antd'
import dayjs from 'dayjs'
import api from '../api/api'
import { DOCUMENTS, documentError, documentFieldRules, documentPayload } from '../utils/digitalDocuments'

export default function DigitalDocumentEditor({ kind, open, editing, onClose, onSaved }) {
  const config = DOCUMENTS[kind]
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    form.resetFields()
    if (editing) form.setFieldsValue(Object.fromEntries(config.fields.map((field) => [
      field.key, ['date', 'datetime'].includes(field.type) && editing[field.key]
        ? dayjs(editing[field.key]) : editing[field.key],
    ])))
  }, [open, editing, config, form])

  const save = async () => {
    let values
    try { values = await form.validateFields() } catch { return }
    setSaving(true)
    try {
      const payload = documentPayload(config.fields, values)
      const { data } = editing
        ? await api.put(`${config.endpoint}/${editing.id}`, payload)
        : await api.post(config.endpoint, payload)
      message.success('Запись сохранена')
      onSaved(data)
    } catch (error) {
      message.error(documentError(error, 'Не удалось сохранить запись'))
    } finally {
      setSaving(false)
    }
  }

  return <Modal title={`${editing ? 'Редактировать' : 'Добавить'} ${config.singular}`}
    open={open} onOk={save} onCancel={() => { if (!saving) onClose() }}
    closable={!saving} maskClosable={!saving} cancelButtonProps={{ disabled: saving }}
    confirmLoading={saving} okText="Сохранить" cancelText="Отмена" width={920} destroyOnClose
  >
    <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
      <Row gutter={16}>
        {config.fields.map((field) => {
          const rules = documentFieldRules(field)
          if (field.key === 'valid_to') rules.push(({ getFieldValue }) => ({
            validator: (_, value) => !value || !getFieldValue('valid_from') || !value.isBefore(getFieldValue('valid_from'), 'day')
              ? Promise.resolve() : Promise.reject(new Error('Дата окончания не может быть раньше даты начала')),
          }))
          return <Col xs={24} md={field.type === 'multiline' ? 24 : 12} key={field.key}>
            <Form.Item name={field.key} label={field.label} rules={rules}
              dependencies={field.key === 'valid_to' ? ['valid_from'] : undefined}
            >
              {field.type === 'date'
                ? <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} />
                : field.type === 'datetime'
                  ? <DatePicker showTime format="DD.MM.YYYY HH:mm:ss" style={{ width: '100%' }} />
                  : field.type === 'multiline'
                    ? <Input.TextArea rows={3} maxLength={field.maxLength} showCount />
                    : <Input maxLength={field.maxLength} allowClear />}
            </Form.Item>
          </Col>
        })}
      </Row>
    </Form>
  </Modal>
}
