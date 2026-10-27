import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Descriptions, Grid, Popconfirm, Space, Spin, Tag, Typography, message } from 'antd'
import { ArrowLeftOutlined, DeleteOutlined, EditOutlined, UndoOutlined } from '@ant-design/icons'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import api from '../../api/api'
import DigitalDocumentEditor from '../../components/DigitalDocumentEditor'
import { DOCUMENTS, TERM_STATUS, displayField, documentError, documentTitle } from '../../utils/digitalDocuments'

export default function DigitalDocumentCardPage({ recordId, recordKind } = {}) {
  const params = useParams()
  const kind = recordKind ?? params.kind
  const id = recordId ?? params.id
  const config = Object.hasOwn(DOCUMENTS, kind) ? DOCUMENTS[kind] : null
  const navigate = useNavigate()
  const [record, setRecord] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState(null)
  const currentRequest = useRef(null)
  const activeDocument = useRef(null)
  const screens = Grid.useBreakpoint()
  const detailColumns = !recordId && screens.md ? 2 : 1

  const load = useCallback(async () => {
    if (!config) return
    currentRequest.current?.abort()
    const request = new AbortController()
    currentRequest.current = request
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get(`${config.endpoint}/${id}`, { signal: request.signal })
      if (!request.signal.aborted) setRecord(data)
    } catch (failure) {
      if (!request.signal.aborted) { setRecord(null); setError(documentError(failure, 'Не удалось открыть запись')) }
    } finally { if (!request.signal.aborted) setLoading(false) }
  }, [config, id])

  useEffect(() => {
    activeDocument.current = { kind, id }
    setBusy(false)
    setEditing(null)
    load()
    return () => { activeDocument.current = null; currentRequest.current?.abort() }
  }, [load, kind, id])

  const edit = async () => {
    const active = activeDocument.current
    setBusy(true)
    try {
      const { data } = await api.get(`${config.endpoint}/${id}`)
      if (activeDocument.current !== active) return
      setRecord(data)
      if (data.is_archived) { message.warning('Сначала восстановите запись из архива'); return }
      setEditing(data)
    } catch (failure) { if (activeDocument.current === active) message.error(documentError(failure, 'Не удалось открыть редактирование')) }
    finally { if (activeDocument.current === active) setBusy(false) }
  }

  const changeArchive = async () => {
    const active = activeDocument.current
    setBusy(true)
    try {
      if (record.is_archived) await api.post(`${config.endpoint}/${id}/restore`)
      else await api.delete(`${config.endpoint}/${id}`)
      if (activeDocument.current !== active) return
      message.success(record.is_archived ? 'Запись восстановлена' : 'Запись перемещена в архив')
      await load()
    } catch (failure) { if (activeDocument.current === active) message.error(documentError(failure, 'Не удалось изменить архив')) }
    finally { if (activeDocument.current === active) setBusy(false) }
  }

  if (!config) return <Navigate to="/digital-documents/ecp" replace />
  const term = record && TERM_STATUS[record.term_status]
  return <div className="inventory-detail-page">
    <Button type="text" className="inventory-detail-back" icon={<ArrowLeftOutlined />} onClick={() => navigate(`/digital-documents/${kind}`)}>
      Учет ЭЦП и МЧД · {config.label}
    </Button>
    {loading ? <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      : error ? <Alert type="error" showIcon message={error} action={<Button onClick={load}>Повторить</Button>} />
        : record && <section className="inventory-detail-card">
          {record.is_archived && <Alert type="warning" showIcon message="Запись находится в архиве" style={{ marginBottom: 16 }} />}
          <header className="inventory-detail-header">
            <div className="inventory-detail-heading">
              <h1 style={{ overflowWrap: 'anywhere' }}>{documentTitle(kind, record)}</h1>
              <Space wrap>
                <Tag>{config.label}</Tag>
                <Tag color={term?.color}>{term?.label}</Tag>
                {record.is_archived && <Tag>Архив</Tag>}
              </Space>
            </div>
            <Space wrap>
              {record.is_archived
                ? <Button icon={<UndoOutlined />} loading={busy} onClick={changeArchive}>Восстановить</Button>
                : <>
                  <Button type="primary" icon={<EditOutlined />} loading={busy} onClick={edit}>Редактировать</Button>
                  <Popconfirm title="Переместить запись в архив?" onConfirm={changeArchive} okText="В архив" cancelText="Отмена" disabled={busy}>
                    <Button danger icon={<DeleteOutlined />} disabled={busy}>В архив</Button>
                  </Popconfirm>
                </>}
            </Space>
          </header>
          <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
            Срок определяется по датам; введённое состояние {kind === 'ecp' ? 'ЭП' : 'МЧД ЭДО'} хранится отдельно.
          </Typography.Paragraph>
          <Descriptions bordered column={detailColumns} items={config.fields.map((field) => ({
            key: field.key, label: field.label,
            span: field.type === 'multiline' ? detailColumns : 1,
            children: <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
              copyable={field.copyable && Boolean(record[field.key])}>
              {displayField(field, record[field.key])}
            </Typography.Paragraph>,
          }))} />
          <Space direction="vertical" style={{ marginTop: 16 }}>
            <Typography.Text type="secondary">Создано: {dayjs(record.created_at).format('DD.MM.YYYY HH:mm:ss')}</Typography.Text>
            <Typography.Text type="secondary">Изменено: {dayjs(record.updated_at).format('DD.MM.YYYY HH:mm:ss')}</Typography.Text>
            {record.archived_at && <Typography.Text type="secondary">Архивировано: {dayjs(record.archived_at).format('DD.MM.YYYY HH:mm:ss')}</Typography.Text>}
          </Space>
        </section>}
    <DigitalDocumentEditor kind={kind} open={Boolean(editing)} editing={editing}
      onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
  </div>
}
