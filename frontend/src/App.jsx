import { lazy, Suspense, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom'
import { Layout, Menu, Button, Drawer, Grid, Space, Typography } from 'antd'
import {
  PrinterOutlined,
  BarChartOutlined,
  SettingOutlined,
  LogoutOutlined,
  InboxOutlined,
  BarcodeOutlined,
  MenuOutlined,
  DesktopOutlined,
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
  { key: '/devices',   icon: <PrinterOutlined />,  label: <Link to="/devices">Устройства</Link> },
  { key: '/warehouse', icon: <InboxOutlined />,    label: <Link to="/warehouse">Склад</Link> },
  { key: '/workplaces', icon: <DesktopOutlined />, label: <Link to="/workplaces">Рабочие места</Link> },
  { key: '/analytics', icon: <BarChartOutlined />,  label: <Link to="/analytics">Аналитика</Link> },
  { key: '/settings',  icon: <SettingOutlined />,   label: <Link to="/settings">Справочники</Link> },
]

function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const [scannerOpen, setScannerOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.lg

  const logout = () => {
    localStorage.removeItem('token')
    navigate('/login', { replace: true })
  }

  const selectedKey = '/' + location.pathname.split('/')[1]

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {!isMobile && <Sider>
        <div style={{ color: '#fff', padding: '16px', fontWeight: 'bold', fontSize: 16 }}>
          Printer Dashboard
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
        />
      </Sider>}
      <Layout>
        <Header className="app-header">
          <Space size={8}>
            {isMobile && <Button icon={<MenuOutlined />} onClick={() => setMenuOpen(true)} aria-label="Открыть меню" />}
            <Typography.Text strong className="app-title">
            Учёт печатающей техники
            </Typography.Text>
          </Space>
          <Space>
            <Button icon={<BarcodeOutlined />} onClick={() => setScannerOpen(true)} aria-label="Сканировать штрихкод" title="Сканировать штрихкод">
              <span className="desktop-only">Сканировать штрихкод</span>
            </Button>
            <Typography.Text className="desktop-only">{getUsername()}</Typography.Text>
            <Button icon={<LogoutOutlined />} onClick={logout} aria-label="Выйти" title="Выйти">
              <span className="desktop-only">Выйти</span>
            </Button>
          </Space>
        </Header>
        <Content className="app-content">
          <Routes>
            <Route path="/" element={<Navigate to="/devices" replace />} />
            <Route path="/devices" element={<PrivateRoute><DevicesPage /></PrivateRoute>} />
            <Route path="/devices/:id" element={<PrivateRoute><DeviceCardPage /></PrivateRoute>} />
            <Route path="/analytics" element={<PrivateRoute><AnalyticsPage /></PrivateRoute>} />
            <Route path="/warehouse" element={<PrivateRoute><WarehousePage /></PrivateRoute>} />
            <Route path="/warehouse/items/:id" element={<PrivateRoute><WarehouseItemPage /></PrivateRoute>} />
            <Route path="/workplaces" element={<PrivateRoute><WorkplacesPage /></PrivateRoute>} />
            <Route path="/workplaces/:id" element={<PrivateRoute><WorkplaceCardPage /></PrivateRoute>} />
            <Route path="/settings" element={<PrivateRoute><SettingsPage /></PrivateRoute>} />
          </Routes>
        </Content>
      </Layout>
      <Drawer
        title="Printer Dashboard"
        placement="left"
        width={280}
        open={isMobile && menuOpen}
        onClose={() => setMenuOpen(false)}
        styles={{ body: { padding: 0, background: '#001529' } }}
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
