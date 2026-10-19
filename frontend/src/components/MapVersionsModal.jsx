import { useEffect, useState } from 'react'
import { Alert, Button, List, Modal, Tag, message } from 'antd'
import dayjs from 'dayjs'
import api from '../api/api'

export default function MapVersionsModal({ open, floor, onClose, onRestore }) {
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ items: [], total: 0 })
  const [loading, setLoading] = useState(false)
  useEffect(() => { if (open) setPage(1) }, [open, floor?.id])
  useEffect(() => {
    if (!open || !floor) return
    let active = true
    setLoading(true)
    api.get(`/maps/floors/${floor.id}/versions`, { params: { page, page_size: 10 } }).then(response => { if (active) setData(response.data) })
      .catch(() => { if (active) message.error('Не удалось загрузить историю планов') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, floor?.id, page])
  return <Modal open={open} title={`История плана: ${floor?.name || ''}`} onCancel={onClose} footer={null} width={680} destroyOnClose>
    <Alert type="info" showIcon message="Версия откроется в редакторе. Проверьте план и сохраните его новой версией." style={{ marginBottom: 16 }} />
    <List loading={loading} dataSource={data.items} locale={{ emptyText: 'Сохранённых версий пока нет' }}
      pagination={data.total > 10 ? { current: page, pageSize: 10, total: data.total, onChange: setPage } : false}
      renderItem={version => <List.Item actions={[<Button key="restore" onClick={() => onRestore(version.revision)}>Загрузить в редактор</Button>]}>
        <List.Item.Meta title={<span>Версия {version.revision} {version.revision === floor?.revision && <Tag color="blue">Текущая</Tag>}{version.label && ` · ${version.label}`}</span>}
          description={`${dayjs(version.saved_at).format('DD.MM.YYYY HH:mm')} · ${version.saved_by || 'Автор не указан'}`} />
      </List.Item>} />
  </Modal>
}
