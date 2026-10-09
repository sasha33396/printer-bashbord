import { useRecordNavigation, useRecordPanel } from '../../components/RecordPanelContext'
import PageHeading from '../../components/PageHeading'
import KpiCards from '../../components/KpiCards'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Popconfirm, Segmented, Select, Space, Tabs, Tag, Typography, message, Alert } from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, UndoOutlined, UploadOutlined } from '@ant-design/icons'
import { Navigate, useParams } from 'react-router-dom'
import api from '../../api/api'
import Table from '../../components/FilterableTable'
import DigitalDocumentEditor from '../../components/DigitalDocumentEditor'
import DigitalDocumentImportModal from '../../components/DigitalDocumentImportModal'
import { DOCUMENTS, TERM_STATUS, displayField, documentError, documentMatches } from '../../utils/digitalDocuments'

function RegisterTab({ kind, refreshKey }) {
  const config = DOCUMENTS[kind]
  const navigate = useRecordNavigation()
  const { revision, selected } = useRecordPanel()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [archived, setArchived] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [search, setSearch] = useState('')
  const [termFilter, setTermFilter] = useState()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const currentRequest = useRef(null)

  const load = useCallback(async () => {
    currentRequest.current?.abort()
    const request = new AbortController()
    currentRequest.current = request
    setLoadError(false)
    setLoading(true)
    try {
      const { data } = await api.get(config.endpoint, { params: { archived }, signal: request.signal })
      if (!request.signal.aborted) setRows(data)
    } catch (error) {
      if (!request.signal.aborted) { setLoadError(true); message.error(documentError(error, 'Не удалось загрузить реестр')) }
    } finally {
      if (!request.signal.aborted) setLoading(false)
    }
  }, [config, archived])

  useEffect(() => { load(); return () => currentRequest.current?.abort() }, [load, refreshKey, revision])

  const edit = async (row) => {
    setBusyId(row.id)
    try {
      const { data } = await api.get(`${config.endpoint}/${row.id}`)
      if (data.is_archived) { message.warning('Сначала восстановите запись из архива'); load(); return }
      setEditing(data)
      setEditorOpen(true)
    } catch (error) {
      message.error(documentError(error, 'Не удалось открыть редактирование'))
    } finally { setBusyId(null) }
  }

  const changeArchive = async (row) => {
    setBusyId(row.id)
    try {
      if (row.is_archived) await api.post(`${config.endpoint}/${row.id}/restore`)
      else await api.delete(`${config.endpoint}/${row.id}`)
      message.success(row.is_archived ? 'Запись восстановлена' : 'Запись перемещена в архив')
      await load()
    } catch (error) { message.error(documentError(error, 'Не удалось изменить архив')) }
    finally { setBusyId(null) }
  }

  const filtered = useMemo(() => rows.filter((row) => (!termFilter || row.term_status === termFilter)
    && documentMatches(config, row, search)), [rows, config, search, termFilter])

  const columns = [
    ...config.fields.map((field, index) => ({
      title: field.label, dataIndex: field.key, key: field.key, width: field.width,
      fixed: index === 0 ? 'left' : undefined,
      sorter: ['date', 'datetime'].includes(field.type)
        ? (a, b) => String(a[field.key] || '').localeCompare(String(b[field.key] || '')) : undefined,
      defaultSortOrder: field.key === 'valid_to' ? 'ascend' : undefined,
      render: (value, row) => field.key === config.titleKey
        ? <Button type="link" style={{ padding: 0, maxWidth: '100%', height: 'auto', textAlign: 'left', whiteSpace: 'normal' }}
            onClick={() => navigate(`/digital-documents/${kind}/${row.id}`)}>{displayField(field, value)}</Button>
        : <Typography.Text style={{ maxWidth: field.width - 24 }} ellipsis={{ tooltip: displayField(field, value) }}>
            {displayField(field, value)}
          </Typography.Text>,
    })),
    { title: 'Срок', key: 'term', width: 170,
      render: (_, row) => <Tag color={TERM_STATUS[row.term_status]?.color}>{TERM_STATUS[row.term_status]?.label}</Tag> },
    { title: '', key: 'actions', width: 225, fixed: 'right', align: 'right', render: (_, row) => <Space size={4}>
      <Button size="small" type="primary" onClick={() => navigate(`/digital-documents/${kind}/${row.id}`)}>Открыть</Button>
      {row.is_archived
        ? <Button size="small" icon={<UndoOutlined />} title="Восстановить" loading={busyId === row.id} disabled={busyId !== null} onClick={() => changeArchive(row)} />
        : <>
          <Button size="small" icon={<EditOutlined />} title="Редактировать" loading={busyId === row.id} disabled={busyId !== null} onClick={() => edit(row)} />
          <Popconfirm title="Переместить запись в архив?" okText="В архив" cancelText="Отмена" onConfirm={() => changeArchive(row)} disabled={busyId !== null}>
            <Button size="small" icon={<DeleteOutlined />} title="В архив" danger disabled={busyId !== null} />
          </Popconfirm>
        </>}
    </Space> },
  ]

  return <>
    {loadError && <Alert className="page-alert" type="error" showIcon message="Не удалось загрузить данные. Проверьте соединение и повторите запрос." action={<Button onClick={() => load()}>Повторить</Button>} />}
    <KpiCards loading={loading} items={[
      { label: archived ? 'Записей в архиве' : `Записей ${config.label}`, value: loadError ? null : rows.length },
      { label: 'Срок действует', value: loadError ? null : rows.filter((row) => row.term_status === 'valid').length, tone: 'green' },
      { label: 'Скоро истекают', value: loadError ? null : rows.filter((row) => row.term_status === 'expiring').length, tone: 'amber', note: 'Не более 30 дней до окончания' },
      { label: 'Срок истёк', value: loadError ? null : rows.filter((row) => row.term_status === 'expired').length, tone: 'red' },
    ]} />
    <div className="page-toolbar" style={{ marginBottom: 16 }}>
      <Segmented value={archived} options={[{ label: 'Актуальные', value: false }, { label: 'Архив', value: true }]}
        onChange={setArchived} disabled={busyId !== null} />
      <Input.Search placeholder="Поиск по всем полям" allowClear value={search}
        onChange={(event) => setSearch(event.target.value)} style={{ width: 280 }} />
      <Select placeholder="Все сроки" allowClear value={termFilter} onChange={setTermFilter} style={{ width: 200 }}
        options={Object.entries(TERM_STATUS).map(([value, item]) => ({ value, label: item.label }))} />
      <div className="toolbar-actions">
        <Button onClick={() => { setSearch(''); setTermFilter(undefined) }}>Сбросить</Button>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Обновить</Button>
        {!archived && <Button type="primary" icon={<PlusOutlined />} disabled={busyId !== null}
          onClick={() => { setEditing(null); setEditorOpen(true) }}>Добавить {config.singular}</Button>}
      </div>
    </div>
    <Typography.Paragraph type="secondary">
      Отметка «Срок» рассчитывается по датам. «Скоро истекает» — осталось не более 30 дней.
    </Typography.Paragraph>
    <Table key={`${kind}-${archived}`} rowKey="id" dataSource={filtered} columns={columns} loading={loading}
      rowClassName={(row) => selected === `/digital-documents/${kind}/${row.id}` ? 'selected-record-row' : ''}
      onRow={(row) => ({ onClick: (event) => { if (!event.target.closest('button,a,input')) navigate(`/digital-documents/${kind}/${row.id}`) } })}
      size="small" scroll={{ x: 'max-content' }} pagination={{ defaultPageSize: 25, showSizeChanger: true, showTotal: (total) => `Записей: ${total}` }} />
    <DigitalDocumentEditor kind={kind} open={editorOpen} editing={editing}
      onClose={() => setEditorOpen(false)} onSaved={() => { setEditorOpen(false); load() }} />
  </>
}

export default function DigitalDocumentsPage() {
  const { kind } = useParams()
  const navigate = useRecordNavigation()
  const [importOpen, setImportOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  if (!Object.hasOwn(DOCUMENTS, kind)) return <Navigate to="/digital-documents/ecp" replace />
  return <>
    <PageHeading title="ЭЦП и МЧД" description="Реестры электронных подписей и машиночитаемых доверенностей"
      actions={<Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>Импорт XLSX</Button>} />
    <Tabs activeKey={kind} destroyInactiveTabPane onChange={(key) => navigate(`/digital-documents/${key}`)}
      items={Object.entries(DOCUMENTS).map(([key, config]) => ({ key, label: config.label, children: <RegisterTab kind={key} refreshKey={refreshKey} /> }))} />
    <DigitalDocumentImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={() => setRefreshKey((value) => value + 1)} />
  </>
}
