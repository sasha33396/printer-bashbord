import { lazy, Suspense, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom'
import { Layout, Menu, Button, Drawer, Grid, Space, Typography, Avatar } from 'antd'
import {
  PrinterOutlined,
  BarChartOutlined,
  SettingOutlined,
  LogoutOutlined,
  InboxOutlined,
  BarcodeOutlined,
  MenuOutlined,
  DesktopOutlined,
  HistoryOutlined,
  SafetyCertificateOutlined,
  HomeOutlined, ToolOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
} from '@ant-design/icons'
import './styles.css'

import DevicesPage from './pages/Devices/DevicesPage'
import DeviceCardPage from './pages/Devices/DeviceCardPage'
import AnalyticsPage from './pages/Analytics/AnalyticsPage'
import SettingsPage from './pages/Settings/SettingsPage'
import LoginPage from './pages/Login/LoginPage'
import WarehousePage from './pages/Warehouse/WarehousePage'
import WarehouseItemPage from './pages/Warehouse/WarehouseItemPage'
import WorkplacesPage from './pages/Workplaces/WorkplacesPage'
import WorkplaceCardPage from './pages/Workplaces/WorkplaceCardPage'
import HistoryPage from './pages/History/HistoryPage'
import DigitalDocumentsPage from './pages/DigitalDocuments/DigitalDocumentsPage'
import DigitalDocumentCardPage from './pages/DigitalDocuments/DigitalDocumentCardPage'
import OverviewPage from './pages/Overview/OverviewPage'
import RepairsPage from './pages/Repairs/RepairsPage'
import RecordPanel from './components/RecordPanel'

const { Header, Sider, Content } = Layout
const BarcodeScannerModal = lazy(() => import('./components/BarcodeScannerModal'))

function getUsername() {
  const token = localStorage.getItem('token')
  if (!token) return ''
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.sub || ''
  } catch {
    return ''
  }
}

function PrivateRoute({ children }) {
  const location = useLocation()
  const next = `${location.pathname}${location.search}`
  return localStorage.getItem('token')
    ? children
    : <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
}

const menuItems = [
  { key: '/', icon: <HomeOutlined />, label: <Link to="/">Обзор</Link> },
  { key: '/devices',   icon: <PrinterOutlined />,  label: <Link to="/devices">Принтеры</Link> },
  { key: '/warehouse', icon: <InboxOutlined />,    label: <Link to="/warehouse">Склад</Link> },
  { key: '/workplaces', icon: <DesktopOutlined />, label: <Link to="/workplaces">Рабочие места</Link> },
  { key: '/repairs', icon: <ToolOutlined />, label: <Link to="/repairs">Ремонты</Link> },
  { key: '/analytics', icon: <BarChartOutlined />,  label: <Link to="/analytics">Аналитика</Link> },
  { key: '/digital-documents', icon: <SafetyCertificateOutlined />, label: <Link to="/digital-documents/ecp">ЭЦП и МЧД</Link> },
  { key: '/history', icon: <HistoryOutlined />, label: <Link to="/history">История движений</Link> },
  { key: '/settings',  icon: <SettingOutlined />,   label: <Link to="/settings">Настройки</Link> },
]

function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const [scannerOpen, setScannerOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true')
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.lg

  const logout = () => {
    localStorage.removeItem('token')
    navigate('/login', { replace: true })
  }

  const selectedKey = '/' + location.pathname.split('/')[1]
  const sectionTitle = { '/': 'Панель управления', '/devices': 'Принтеры', '/warehouse': 'Склад',
    '/workplaces': 'Рабочие места', '/repairs': 'Ремонты', '/analytics': 'Аналитика',
    '/digital-documents': 'ЭЦП и МЧД', '/history': 'История движений', '/settings': 'Настройки' }[selectedKey] || 'printer-bashbord'
  const username = getUsername()
  const toggleSidebar = () => setCollapsed((value) => {
    localStorage.setItem('sidebarCollapsed', String(!value))
    return !value
  })

  return (
    <Layout className="app-shell" style={{ '--sidebar-width': isMobile ? '0px' : collapsed ? '64px' : '212px' }}>
      {!isMobile && <Sider width={212} collapsedWidth={64} collapsed={collapsed} className="app-sidebar">
        <div className="app-brand" title="printer-bashbord">
          <span className="brand-icon"><PrinterOutlined /></span>
          {!collapsed && <span>printer-bashbord</span>}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
        />
        <div className="sidebar-footer">{!collapsed && <span>Учёт IT-активов</span>}<Button type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={toggleSidebar} aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'} /></div>
      </Sider>}
      <Layout className="app-main-layout">
        <Header className="app-header">
          <Space size={8}>
            {isMobile && <Button icon={<MenuOutlined />} onClick={() => setMenuOpen(true)} aria-label="Открыть меню" />}
            <Typography.Text strong className="app-title">
              {sectionTitle}
            </Typography.Text>
          </Space>
          <Space>
            <Button icon={<BarcodeOutlined />} onClick={() => setScannerOpen(true)} aria-label="Сканировать штрихкод" title="Сканировать штрихкод">
              <span className="desktop-only">Сканировать штрихкод</span>
            </Button>
            <div className="header-user"><Avatar size={32}>{username.slice(0, 2).toUpperCase()}</Avatar><Typography.Text className="desktop-only">{username}</Typography.Text></div>
            <Button icon={<LogoutOutlined />} onClick={logout} aria-label="Выйти" title="Выйти">
              <span className="desktop-only">Выйти</span>
            </Button>
          </Space>
        </Header>
        <Content className="app-content">
          <RecordPanel><Routes>
            <Route path="/" element={<PrivateRoute><OverviewPage /></PrivateRoute>} />
            <Route path="/repairs" element={<PrivateRoute><RepairsPage /></PrivateRoute>} />
            <Route path="/devices" element={<PrivateRoute><DevicesPage /></PrivateRoute>} />
            <Route path="/devices/:id" element={<PrivateRoute><DeviceCardPage /></PrivateRoute>} />
            <Route path="/analytics" element={<PrivateRoute><AnalyticsPage /></PrivateRoute>} />
            <Route path="/warehouse" element={<PrivateRoute><WarehousePage /></PrivateRoute>} />
            <Route path="/warehouse/archive" element={<PrivateRoute><WarehousePage archiveOnly /></PrivateRoute>} />
            <Route path="/warehouse/items/:id" element={<PrivateRoute><WarehouseItemPage /></PrivateRoute>} />
            <Route path="/workplaces" element={<PrivateRoute><WorkplacesPage /></PrivateRoute>} />
            <Route path="/workplaces/:id" element={<PrivateRoute><WorkplaceCardPage /></PrivateRoute>} />
            <Route path="/history" element={<PrivateRoute><HistoryPage /></PrivateRoute>} />
            <Route path="/digital-documents" element={<PrivateRoute><Navigate to="/digital-documents/ecp" replace /></PrivateRoute>} />
            <Route path="/digital-documents/:kind" element={<PrivateRoute><DigitalDocumentsPage /></PrivateRoute>} />
            <Route path="/digital-documents/:kind/:id" element={<PrivateRoute><DigitalDocumentCardPage /></PrivateRoute>} />
            <Route path="/settings" element={<PrivateRoute><SettingsPage /></PrivateRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes></RecordPanel>
        </Content>
      </Layout>
      <Drawer
        title="printer-bashbord"
        placement="left"
        width={280}
        open={isMobile && menuOpen}
        onClose={() => setMenuOpen(false)}
        styles={{ body: { padding: 0, background: '#17263C' } }}
      >
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={() => setMenuOpen(false)}
        />
      </Drawer>
      {scannerOpen && (
        <Suspense fallback={null}>
          <BarcodeScannerModal open onClose={() => setScannerOpen(false)} />
        </Suspense>
      )}
    </Layout>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/*" element={<AppLayout />} />
      </Routes>
    </BrowserRouter>
  )
}
