import { useEffect, useMemo, useState } from 'react'
import {
  Button, Col, DatePicker, Form, Input, InputNumber, Modal, Row, Select, Space,
  Typography, Upload, message,
} from 'antd'
import {
  DeleteOutlined, DownloadOutlined, FilePdfOutlined, MinusCircleOutlined,
  PlusOutlined, UploadOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import api from '../api/api'

const REPAIR_TYPE_OPTIONS = [
  { value: 'planned', label: 'Плановый' },
  { value: 'unplanned', label: 'Внеплановый' },
  { value: 'warranty', label: 'Гарантийный' },
]

const REPAIR_STATUS_OPTIONS = [
  { value: 'in_progress', label: 'В ремонте' },
  { value: 'completed', label: 'Завершён' },
  { value: 'impossible', label: 'Ремонт невозможен' },
]

const apiErrorMessage = (error, fallback) => {
  const detail = error.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map((item) => item.msg).filter(Boolean).join('; ') || fallback
  }
  return fallback
}

const dateValue = (value) => (value ? dayjs(value) : undefined)
const apiDate = (value) => (value ? value.format('YYYY-MM-DD') : null)

function defaultSource(device) {
  return [
    device?.department?.branch?.name,
    device?.department?.name,
    device?.location,
  ].filter(Boolean).join(', ')
}

export default function RepairEditorModal({ open, editing, device, onClose, onSaved }) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [invoiceFile, setInvoiceFile] = useState(null)
  const [removeInvoice, setRemoveInvoice] = useState(false)
  const status = Form.useWatch('repair_status', form)
  const workItems = Form.useWatch('work_items', form)

  const workTotal = useMemo(
    () => (workItems || []).reduce((sum, item) => sum + Number(item?.cost || 0), 0),
    [workItems],
  )

  useEffect(() => {
    if (!open) return
    setInvoiceFile(null)
    setRemoveInvoice(false)
    if (editing) {
      form.setFieldsValue({
        date: dateValue(editing.date),
        repair_type: editing.repair_type,
        repair_status: editing.repair_status,
        task_date: dateValue(editing.task_date),
        task_url: editing.task_url,
        source_location: editing.source_location,
        responsible_person: editing.responsible_person,
        returned_date: dateValue(editing.returned_date),
        connected_date: dateValue(editing.connected_date),
        description: editing.description,
        contractor: editing.contractor,
        completion_page_counter: editing.completion_page_counter,
        work_items: editing.work_items || [],
        cost: editing.cost || 0,
        notes: editing.notes,
      })
    } else {
      form.resetFields()
      form.setFieldsValue({
        date: dayjs(),
        repair_status: 'in_progress',
        source_location: defaultSource(device),
        work_items: [],
        cost: 0,
      })
    }
  }, [open, editing, device, form])

  useEffect(() => {
    if (workItems?.length) form.setFieldValue('cost', workTotal)
  }, [form, workItems, workTotal])

  const downloadInvoice = async () => {
    try {
      const response = await api.get(`/repairs/${editing.id}/invoice`, { responseType: 'blob' })
      const url = URL.createObjectURL(response.data)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = editing.invoice_name || 'invoice.pdf'
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      message.error(apiErrorMessage(error, 'Не удалось скачать счёт'))
    }
  }

  const selectInvoice = (file) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      message.error('Выберите PDF-файл')
      return Upload.LIST_IGNORE
    }
    if (file.size > 20 * 1024 * 1024) {
      message.error('Размер PDF не должен превышать 20 МБ')
      return Upload.LIST_IGNORE
    }
    setInvoiceFile(file)
    setRemoveInvoice(false)
    return Upload.LIST_IGNORE
  }

  const handleSave = async () => {
    let values
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setSaving(true)
    try {
      const payload = {
        ...values,
        device_id: device.id,
        date: apiDate(values.date),
        task_date: apiDate(values.task_date),
        returned_date: apiDate(values.returned_date),
        connected_date: apiDate(values.connected_date),
        cost: Number(values.cost || 0),
        work_items: values.work_items || [],
      }
      if (status !== 'completed') delete payload.completion_page_counter

      const response = editing
        ? await api.put(`/repairs/${editing.id}`, payload)
        : await api.post('/repairs', payload)
      const repair = response.data

      try {
        if (removeInvoice && editing?.invoice_name && !invoiceFile) {
          await api.delete(`/repairs/${repair.id}/invoice`)
        }
        if (invoiceFile) {
          const data = new FormData()
          data.append('file', invoiceFile)
          await api.post(`/repairs/${repair.id}/invoice`, data)
        }
      } catch (invoiceError) {
        message.warning(`${editing ? 'Ремонт обновлён' : 'Ремонт добавлен'}, но PDF не сохранён: ${apiErrorMessage(invoiceError, 'ошибка загрузки')}`)
        onSaved()
        return
      }

      message.success(editing ? 'Ремонт обновлён' : 'Ремонт добавлен')
      onSaved()
    } catch (error) {
      message.error(apiErrorMessage(error, 'Не удалось сохранить ремонт'))
    } finally {
      setSaving(false)
    }
  }

  const visibleInvoiceName = invoiceFile?.name
    || (!removeInvoice ? editing?.invoice_name : null)

  return (
    <Modal
      title={editing ? 'Редактировать ремонт' : 'Добавить ремонт'}
      open={open}
      onOk={handleSave}
      onCancel={onClose}
      confirmLoading={saving}
      okText="Сохранить"
      cancelText="Отмена"
      width={860}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Typography.Title level={5}>Задача и состояние</Typography.Title>
        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item name="task_date" label="Задача от">
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
          </Col>
          <Col xs={24} md={16}>
            <Form.Item
              name="task_url"
              label="Ссылка на задачу"
              rules={[{ type: 'url', message: 'Введите корректную ссылку' }]}
            >
              <Input placeholder="https://..." />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="date" label="Забрали в ремонт" rules={[{ required: true, message: 'Укажите дату' }]}>
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="repair_type" label="Тип ремонта" rules={[{ required: true, message: 'Выберите тип' }]}>
              <Select options={REPAIR_TYPE_OPTIONS} placeholder="Выберите тип" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="repair_status" label="Состояние" rules={[{ required: true }]}>
              <Select options={REPAIR_STATUS_OPTIONS} />
            </Form.Item>
          </Col>
        </Row>

        <Typography.Title level={5}>Место и ответственные</Typography.Title>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="source_location" label="Откуда">
              <Input placeholder="Филиал, склад или отдел" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="responsible_person" label="Ответственное лицо">
              <Input placeholder="ФИО, необязательно" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="contractor" label="Исполнитель ремонта">
              <Input placeholder="ФИО или организация" />
            </Form.Item>
          </Col>
        </Row>

        <Typography.Title level={5}>Диагностика</Typography.Title>
        <Form.Item
          name="description"
          label="Технический осмотр и неисправность"
          rules={[{ required: true, message: 'Опишите неисправность' }]}
        >
          <Input.TextArea rows={3} />
        </Form.Item>

        <Typography.Title level={5}>Результат ремонта</Typography.Title>
        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item name="returned_date" label="Вернули из ремонта">
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="connected_date" label="Подключили">
              <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
            </Form.Item>
          </Col>
          {status === 'completed' && (
            <Col xs={24} md={8}>
              <Form.Item
                name="completion_page_counter"
                label="Счётчик при возврате"
                extra="Если оставить пустым, приложение опросит IP принтера"
              >
                <InputNumber style={{ width: '100%' }} min={0} />
              </Form.Item>
            </Col>
          )}
        </Row>

        <Typography.Title level={5}>Проведённые работы</Typography.Title>
        <Form.List name="work_items">
          {(fields, { add, remove }) => (
            <Space direction="vertical" style={{ width: '100%' }} size={8}>
              {fields.map(({ key, name, ...restField }) => (
                <Row gutter={8} align="top" key={key}>
                  <Col xs={24} sm={16}>
                    <Form.Item
                      {...restField}
                      name={[name, 'description']}
                      rules={[{ required: true, message: 'Укажите выполненную работу' }]}
                      style={{ marginBottom: 8 }}
                    >
                      <Input placeholder="Наименование работы" />
                    </Form.Item>
                  </Col>
                  <Col xs={20} sm={7}>
                    <Form.Item
                      {...restField}
                      name={[name, 'cost']}
                      rules={[{ required: true, message: 'Укажите сумму' }]}
                      style={{ marginBottom: 8 }}
                    >
                      <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="Стоимость" />
                    </Form.Item>
                  </Col>
                  <Col xs={4} sm={1}>
                    <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(name)} />
                  </Col>
                </Row>
              ))}
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ cost: 0 })} block>
                Добавить работу
              </Button>
            </Space>
          )}
        </Form.List>
        <Row gutter={16} style={{ marginTop: 16 }}>
          <Col xs={24} md={8}>
            <Form.Item name="cost" label="Итого">
              <InputNumber
                min={0}
                precision={2}
                style={{ width: '100%' }}
                disabled={Boolean(workItems?.length)}
                addonAfter="₽"
              />
            </Form.Item>
          </Col>
        </Row>

        <Typography.Title level={5}>Счёт</Typography.Title>
        <Space wrap>
          <Upload accept="application/pdf,.pdf" showUploadList={false} beforeUpload={selectInvoice}>
            <Button icon={<UploadOutlined />}>{visibleInvoiceName ? 'Заменить PDF' : 'Прикрепить PDF'}</Button>
          </Upload>
          {visibleInvoiceName && (
            <Typography.Text><FilePdfOutlined /> {visibleInvoiceName}</Typography.Text>
          )}
          {editing?.invoice_name && !removeInvoice && !invoiceFile && (
            <Button type="text" icon={<DownloadOutlined />} onClick={downloadInvoice}>Скачать</Button>
          )}
          {visibleInvoiceName && (
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => {
                setInvoiceFile(null)
                setRemoveInvoice(Boolean(editing?.invoice_name))
              }}
            >
              Убрать
            </Button>
          )}
        </Space>

        <Form.Item name="notes" label="Примечание" style={{ marginTop: 20 }}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
