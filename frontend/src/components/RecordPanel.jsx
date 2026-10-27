import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Drawer, Grid } from 'antd'
import { CloseOutlined, ExportOutlined } from '@ant-design/icons'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import DeviceCardPage from '../pages/Devices/DeviceCardPage'
import WarehouseItemPage from '../pages/Warehouse/WarehouseItemPage'
import WorkplaceCardPage from '../pages/Workplaces/WorkplaceCardPage'
import DigitalDocumentCardPage from '../pages/DigitalDocuments/DigitalDocumentCardPage'
import { PanelContext, recordPatterns } from './RecordPanelContext'

export default function RecordPanel({ children }) {
  const location = useLocation()
  const navigate = useNavigate()
  const screens = Grid.useBreakpoint()
  const [revision, setRevision] = useState(0)
  const selected = new URLSearchParams(location.search).get('record')
  const entry = selected && recordPatterns.find((item) => item.pattern.test(selected))
  const matches = entry && selected.match(entry.pattern)
  const previous = useRef(selected)
  useEffect(() => {
    if (previous.current && !selected) setRevision((value) => value + 1)
    previous.current = selected
  }, [selected])
  const open = useCallback((path) => {
    const query = new URLSearchParams(location.search)
    query.set('record', path)
    navigate({ pathname: location.pathname, search: query.toString() })
  }, [location.pathname, location.search, navigate])
  const close = useCallback(() => {
    const query = new URLSearchParams(location.search)
    query.delete('record')
    navigate({ pathname: location.pathname, search: query.toString() })
  }, [location.pathname, location.search, navigate])
  useEffect(() => {
    if (!entry) return
    const escape = (event) => { if (event.key === 'Escape' && !document.querySelector('.ant-modal-wrap')) close() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [entry, close])
  const detail = entry && <div className="record-detail" key={selected}>
    {entry.type === 'device' && <DeviceCardPage recordId={matches[1]} />}
    {entry.type === 'warehouse' && <WarehouseItemPage recordId={matches[1]} />}
    {entry.type === 'workplace' && <WorkplaceCardPage recordId={matches[1]} />}
    {entry.type === 'document' && <DigitalDocumentCardPage recordKind={matches[1]} recordId={matches[2]} />}
  </div>
  const title = <div className="record-panel-title"><strong>{entry?.title}</strong>
    <Link to={selected || '#'} aria-label="Открыть карточку отдельной страницей" title="Открыть карточку отдельной страницей"><ExportOutlined /></Link>
  </div>
  return <PanelContext.Provider value={{ open, revision, selected }}>
    <div className={`workspace-grid${entry && screens.xl ? ' has-record' : ''}`}>
      <div className="workspace-main">{children}</div>
      {entry && screens.xl && <aside className="record-panel" aria-label={entry.title}>
        <div className="record-panel-header">{title}<Button type="text" icon={<CloseOutlined />} onClick={close} aria-label="Закрыть карточку" /></div>
        {detail}
      </aside>}
    </div>
    <Drawer title={title} open={Boolean(entry && !screens.xl)} onClose={close} width="min(560px, 100vw)" className="record-drawer" destroyOnClose>
      {!screens.xl && detail}
    </Drawer>
  </PanelContext.Provider>
}
