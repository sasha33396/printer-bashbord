import { useRef, useState } from 'react'
import { Alert, Button, Descriptions, Modal, Segmented, Space, Tag, Typography, Upload, message } from 'antd'
import { DownloadOutlined, InboxOutlined } from '@ant-design/icons'
import api from '../api/api'
import Table from './FilterableTable'
import { DOCUMENTS, displayField, documentError } from '../utils/digitalDocuments'
import { IMPORT_STATUSES, importReportPayload, importReportSummary, importRowTitle } from '../utils/digitalDocumentImport'

export default function DigitalDocumentImportModal({ open, onClose, onImported }) {
  const [file, setFile] = useState(null)
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [onlyIssues, setOnlyIssues] = useState(false)
  const running = useRef(false)
  const exporting = useRef(false)

  const close = () => {
    if (running.current || exporting.current) return
    setFile(null); setReport(null); setError(''); setOnlyIssues(false); onClose()
  }

  const selectFile = (selected) => {
    if (running.current || exporting.current) return false
    if (!selected.name.toLowerCase().endsWith('.xlsx') || selected.size > 10 * 1024 * 1024) {
      message.error('Выберите файл .xlsx размером до 10 МБ')
      return Upload.LIST_IGNORE
    }
    setFile(selected); setReport(null); setError(''); setOnlyIssues(false)
    return false
  }

  const check = async (apply = false) => {
    if (!file || running.current || exporting.current || apply && (!report?.can_apply || report.applied)) return
    running.current = true; setBusy(true); setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.post('/digital-documents/import-xlsx', form, { params: { apply } })
      setReport(data)
      if (data.applied) {
        message.success(`Добавлено записей: ${data.totals.created}`)
        onImported()
      }
    } catch (failure) {
      setReport(null)
      setError(documentError(failure, 'Не удалось импортировать файл. Проверьте соединение и повторите проверку'))
    } finally { running.current = false; setBusy(false) }
  }

  const downloadReport = async () => {
    if (!report || running.current || exporting.current) return
    exporting.current = true; setDownloading(true)
    try {
      const { data } = await api.post('/digital-documents/import-report-xlsx', importReportPayload(report, file?.name || ''), { responseType: 'blob' })
      const url = URL.createObjectURL(data)
      const link = document.createElement('a')
      link.href = url
      link.download = `ecp-mchd-import-report-${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`
      document.body.appendChild(link); link.click(); link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      message.error('Не удалось скачать отчёт. Повторите попытку')
    } finally { exporting.current = false; setDownloading(false) }
  }

  const summary = report ? importReportSummary(report) : null
  const blocked = busy || downloading

  const columns = [
    { title: 'Лист', dataIndex: 'sheet', width: 70 },
    { title: 'Строка Excel', dataIndex: 'row', width: 105 },
    { title: 'Запись', key: 'title', width: 280,
      render: (_, row) => importRowTitle(row) },
    { title: 'Результат', dataIndex: 'status', width: 170,
      render: (value) => <Tag color={IMPORT_STATUSES[value]?.color}>{IMPORT_STATUSES[value]?.label}</Tag> },
    { title: 'Пояснение', dataIndex: 'message', width: 380,
      render: (value, row) => <>{value || 'Новая запись'}{row.existing_id && <> · <a href={`/digital-documents/${row.kind}/${row.existing_id}`} target="_blank" rel="noreferrer">Открыть запись</a></>}</> },
  ]

  return <Modal title="Импорт ЭЦП и МЧД из Excel" open={open} onCancel={close} width={1100}
    closable={!blocked} maskClosable={!blocked} keyboard={!blocked} footer={<Space wrap>
      <Button onClick={close} disabled={blocked}>{report?.applied ? 'Закрыть' : 'Отмена'}</Button>
      {report && <Button icon={<DownloadOutlined />} onClick={downloadReport} loading={downloading} disabled={busy}>Скачать отчёт XLSX</Button>}
      {!report?.applied && <Button onClick={() => check(false)} loading={busy} disabled={!file || downloading}>Проверить файл</Button>}
      {!report?.applied && <Button type="primary" onClick={() => check(true)} loading={busy}
        disabled={!report?.can_apply || !report?.totals.new || downloading}>Добавить корректные ({report?.totals.new || 0})</Button>}
    </Space>}>
    <Typography.Paragraph>
      Один файл .xlsx с листами «ЭЦП» и «МЧД». Заголовки столбцов — как в реестре; порядок произвольный.
      Сначала проверьте файл. Корректные новые записи можно добавить сразу; ошибки и несовпадения останутся в отчёте.
      Существующие записи остаются без изменений.
    </Typography.Paragraph>
    <Upload.Dragger accept=".xlsx" maxCount={1} beforeUpload={selectFile} disabled={blocked}
      fileList={file ? [{ uid: file.uid || 'xlsx', name: file.name, status: 'done' }] : []}
      onRemove={() => { if (running.current || exporting.current) return false; setFile(null); setReport(null); setError(''); setOnlyIssues(false); return true }}>
      <p className="ant-upload-drag-icon"><InboxOutlined /></p>
      <p className="ant-upload-text">Выберите файл или перетащите его сюда</p>
      <p className="ant-upload-hint">До 10 МБ. ИНН, СНИЛС и длинные номера лучше хранить в Excel как текст.</p>
    </Upload.Dragger>
    {error && <Alert style={{ marginTop: 16 }} type="error" showIcon message={error} />}
    {report && <>
      <Alert style={{ margin: '16px 0' }} showIcon
        type={summary.type} message={summary.title} description={summary.description} />
      {report.warnings.length > 0 && <Alert style={{ marginBottom: 16 }} type="warning" showIcon message="Обратите внимание"
        description={report.warnings.map((warning, index) => <div key={index}>{warning}</div>)} />}
      <Segmented style={{ marginBottom: 12 }} value={onlyIssues} onChange={setOnlyIssues}
        options={[{ label: 'Все строки', value: false }, { label: 'Ошибки и несовпадения', value: true }]} />
      <Table rowKey={(row) => `${row.kind}-${row.row}`} size="small"
        dataSource={onlyIssues ? report.rows.filter((row) => ['error', 'conflict'].includes(row.status)) : report.rows} columns={columns}
        scroll={{ x: 1000 }} pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        expandable={{ rowExpandable: (row) => Boolean(row.data || row.source_data), expandedRowRender: (row) => <Descriptions size="small" column={2} bordered>
          {DOCUMENTS[row.kind].fields.map((field) => <Descriptions.Item key={field.key} label={field.label}>
            <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.data ? displayField(field, row.data[field.key]) : row.source_data?.[field.key] ?? '—'}</span>
          </Descriptions.Item>)}
        </Descriptions> }} />
    </>}
  </Modal>
}
