import { useState } from 'react'
import { Form, Input, Button, Typography, Alert } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import api from '../../api/api'

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const onFinish = async ({ username, password }) => {
    setError('')
    setLoading(true)
    try {
      const params = new URLSearchParams({ username, password })
      const { data } = await api.post('/auth/login', params)
      localStorage.setItem('token', data.access_token)
      const next = searchParams.get('next')
      navigate(next?.startsWith('/') && !next.startsWith('//') ? next : '/devices', { replace: true })
    } catch (err) {
      setError(
        err.response?.status === 401
          ? 'Неверный логин или пароль'
          : 'Ошибка сервера, попробуйте позже'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      background: '#f0f2f5',
    }}>
      <div className="login-card" style={{
        width: 380,
        background: '#fff',
        borderRadius: 8,
        padding: '40px 40px 32px',
        boxShadow: '0 2px 16px rgba(0,0,0,0.10)',
      }}>
        <Typography.Title level={3} style={{ textAlign: 'center', marginBottom: 8 }}>
          Printer Dashboard
        </Typography.Title>
        <Typography.Text type="secondary" style={{ display: 'block', textAlign: 'center', marginBottom: 28 }}>
          Учёт печатающей техники
        </Typography.Text>

        {error && (
          <Alert
            type="error"
            message={error}
            showIcon
            style={{ marginBottom: 20 }}
          />
        )}

        <Form layout="vertical" onFinish={onFinish} autoComplete="off">
          <Form.Item
            name="username"
            label="Логин"
            rules={[{ required: true, message: 'Введите логин' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="Логин" size="large" />
          </Form.Item>

          <Form.Item
            name="password"
            label="Пароль"
            rules={[{ required: true, message: 'Введите пароль' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Пароль" size="large" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
            <Button type="primary" htmlType="submit" block size="large" loading={loading}>
              Войти
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  )
}
