import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom'
import { Layout, Menu, Button, Space, Typography } from 'antd'
import {
  PrinterOutlined,
  BarChartOutlined,
  SettingOutlined,
  LogoutOutlined,
  InboxOutlined,
  QrcodeOutlined,
} from '@ant-design/icons'

import DevicesPage from './pages/Devices/DevicesPage'
import DeviceCardPage from './pages/Devices/DeviceCardPage'
import AnalyticsPage from './pages/Analytics/AnalyticsPage'
import SettingsPage from './pages/Settings/SettingsPage'
import LoginPage from './pages/Login/LoginPage'
import WarehousePage from './pages/Warehouse/WarehousePage'
import WarehouseItemPage from './pages/Warehouse/WarehouseItemPage'
import QrScannerModal from './components/QrScannerModal'

const { Header, Sider, Content } = Layout

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
  { key: '/analytics', icon: <BarChartOutlined />,  label: <Link to="/analytics">Аналитика</Link> },
  { key: '/settings',  icon: <SettingOutlined />,   label: <Link to="/settings">Справочники</Link> },
]

function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const [scannerOpen, setScannerOpen] = useState(false)

  const logout = () => {
    localStorage.removeItem('token')
    navigate('/login', { replace: true })
  }

  const selectedKey = '/' + location.pathname.split('/')[1]

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth="0">
        <div style={{ color: '#fff', padding: '16px', fontWeight: 'bold', fontSize: 16 }}>
          Printer Dashboard
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
        />
      </Sider>
      <Layout>
        <Header style={{
          background: '#fff',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <Typography.Text strong style={{ fontSize: 18 }}>
            Учёт печатающей техники
          </Typography.Text>
          <Space>
            <Button icon={<QrcodeOutlined />} onClick={() => setScannerOpen(true)}>Сканировать QR</Button>
            <Typography.Text>{getUsername()}</Typography.Text>
            <Button icon={<LogoutOutlined />} onClick={logout}>Выйти</Button>
          </Space>
        </Header>
        <Content style={{ margin: '24px', background: '#fff', padding: 24, borderRadius: 8 }}>
          <Routes>
            <Route path="/" element={<Navigate to="/devices" replace />} />
            <Route path="/devices" element={<PrivateRoute><DevicesPage /></PrivateRoute>} />
            <Route path="/devices/:id" element={<PrivateRoute><DeviceCardPage /></PrivateRoute>} />
            <Route path="/analytics" element={<PrivateRoute><AnalyticsPage /></PrivateRoute>} />
            <Route path="/warehouse" element={<PrivateRoute><WarehousePage /></PrivateRoute>} />
            <Route path="/warehouse/items/:id" element={<PrivateRoute><WarehouseItemPage /></PrivateRoute>} />
            <Route path="/settings" element={<PrivateRoute><SettingsPage /></PrivateRoute>} />
          </Routes>
        </Content>
      </Layout>
      <QrScannerModal open={scannerOpen} onClose={() => setScannerOpen(false)} />
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
