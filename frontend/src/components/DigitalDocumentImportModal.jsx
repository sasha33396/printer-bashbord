import { useRef, useState } from 'react'
import { Alert, Button, Descriptions, Modal, Space, Tag, Typography, Upload, message } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import api from '../api/api'
import Table from './FilterableTable'
import { DOCUMENTS, displayField, documentError, documentTitle } from '../utils/digitalDocuments'

const statuses = {
  new: { label: 'Будет добавлено', color: 'green' },
  unchanged: { label: 'Уже есть / повтор', color: 'default' },
  error: { label: 'Ошибка', color: 'red' },
  conflict: { label: 'Нужно сверить', color: 'orange' },
}

export default function DigitalDocumentImportModal({ open, onClose, onImported }) {
  const [file, setFile] = useState(null)
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const running = useRef(false)

  const close = () => {
    if (running.current) return
    setFile(null); setReport(null); setError(''); onClose()
  }

  const selectFile = (selected) => {
    if (running.current) return false
    if (!selected.name.toLowerCase().endsWith('.xlsx') || selected.size > 10 * 1024 * 1024) {
      message.error('Выберите файл .xlsx размером до 10 МБ')
      return Upload.LIST_IGNORE
    }
    setFile(selected); setReport(null); setError('')
    return false
  }

  const check = async (apply = false) => {
    if (!file || running.current || apply && (!report?.can_apply || report.applied)) return
    running.current = true; setBusy(true); setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.post('/digital-documents/import-xlsx', form, { params: { apply } })
      setReport(data)
      if (data.applied) {
        message.success(`Добавлено записей: ${data.totals.new}`)
        onImported()
      }
    } catch (failure) {
      setReport(null)
      setError(documentError(failure, 'Не удалось импортировать файл. Проверьте соединение и повторите проверку'))
    } finally { running.current = false; setBusy(false) }
  }

  const columns = [
    { title: 'Лист', dataIndex: 'sheet', width: 70 },
    { title: 'Строка Excel', dataIndex: 'row', width: 105 },
    { title: 'Запись', key: 'title', width: 280,
      render: (_, row) => row.data ? documentTitle(row.kind, row.data) : '—' },
    { title: 'Результат', dataIndex: 'status', width: 170,
      render: (value) => <Tag color={statuses[value]?.color}>{value === 'new' && report?.applied ? 'Добавлено' : statuses[value]?.label}</Tag> },
    { title: 'Пояснение', dataIndex: 'message', width: 380,
      render: (value, row) => <>{value || 'Новая запись'}{row.existing_id && <> · <a href={`/digital-documents/${row.kind}/${row.existing_id}`} target="_blank" rel="noreferrer">Открыть существующую</a></>}</> },
  ]

  return <Modal title="Импорт ЭЦП и МЧД из Excel" open={open} onCancel={close} width={1100}
    closable={!busy} maskClosable={!busy} keyboard={!busy} footer={<Space wrap>
      <Button onClick={close} disabled={busy}>{report?.applied ? 'Закрыть' : 'Отмена'}</Button>
      {!report?.applied && <Button onClick={() => check(false)} loading={busy} disabled={!file}>Проверить файл</Button>}
      {!report?.applied && <Button type="primary" onClick={() => check(true)} loading={busy}
        disabled={!report?.can_apply || !report?.totals.new}>Импортировать {report?.totals.new || ''}</Button>}
    </Space>}>
    <Typography.Paragraph>
      Один файл .xlsx с листами «ЭЦП» и «МЧД». Заголовки столбцов — как в реестре; порядок произвольный.
      Сначала проверьте файл. Импорт добавляет новые записи, существующие остаются без изменений.
    </Typography.Paragraph>
    <Upload.Dragger accept=".xlsx" maxCount={1} beforeUpload={selectFile} disabled={busy}
      fileList={file ? [{ uid: file.uid || 'xlsx', name: file.name, status: 'done' }] : []}
      onRemove={() => { if (running.current) return false; setFile(null); setReport(null); setError(''); return true }}>
      <p className="ant-upload-drag-icon"><InboxOutlined /></p>
      <p className="ant-upload-text">Выберите файл или перетащите его сюда</p>
      <p className="ant-upload-hint">До 10 МБ. ИНН, СНИЛС и длинные номера лучше хранить в Excel как текст.</p>
    </Upload.Dragger>
    {error && <Alert style={{ marginTop: 16 }} type="error" showIcon message={error} />}
    {report && <>
      <Alert style={{ margin: '16px 0' }} showIcon
        type={report.applied ? 'success' : report.can_apply ? 'info' : 'error'}
        message={report.applied ? 'Импорт завершён' : report.can_apply ? 'Файл проверен' : 'Импорт остановлен: исправьте ошибки и несовпадения'}
        description={`${report.applied ? 'Добавлено' : 'Новых'}: ${report.totals.new}; уже есть / повторов: ${report.totals.unchanged}; ошибок: ${report.totals.error}; нужно сверить: ${report.totals.conflict}.`} />
      {report.warnings.length > 0 && <Alert style={{ marginBottom: 16 }} type="warning" showIcon message="Обратите внимание"
        description={report.warnings.map((warning, index) => <div key={index}>{warning}</div>)} />}
      <Table rowKey={(row) => `${row.kind}-${row.row}`} size="small" dataSource={report.rows} columns={columns}
        scroll={{ x: 1000 }} pagination={{ pageSize: 20, showSizeChanger: true }}
        expandable={{ rowExpandable: (row) => Boolean(row.data), expandedRowRender: (row) => <Descriptions size="small" column={2} bordered>
          {DOCUMENTS[row.kind].fields.map((field) => <Descriptions.Item key={field.key} label={field.label}>
            <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{displayField(field, row.data[field.key])}</span>
          </Descriptions.Item>)}
        </Descriptions> }} />
    </>}
  </Modal>
}
