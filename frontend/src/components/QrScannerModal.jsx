import { useRef, useState } from 'react'
import { Alert, Button, Modal, Space, Typography, message } from 'antd'
import { CameraOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import jsQR from 'jsqr'
import { qrTargetPath } from '../utils/qr'

export default function QrScannerModal({ open, onClose }) {
  const inputRef = useRef(null)
  const navigate = useNavigate()
  const [reading, setReading] = useState(false)

  const readFile = async (file) => {
    if (!file) return
    setReading(true)
    try {
      const bitmap = await createImageBitmap(file)
      const canvas = document.createElement('canvas')
      const maxSide = 1800
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const image = context.getImageData(0, 0, canvas.width, canvas.height)
      const result = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })
      const path = result && qrTargetPath(result.data)
      if (!path) throw new Error('На фотографии нет QR-кода приложения')
      onClose()
      navigate(path)
    } catch (error) {
      message.error(error.message || 'Не удалось распознать QR-код')
    } finally {
      setReading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <Modal title="Поиск по QR-коду" open={open} onCancel={onClose} footer={null} destroyOnClose>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="Сканирование работает по HTTP"
          description="На телефоне нажмите кнопку и сфотографируйте QR. Это не требует прямого доступа браузера к видеопотоку."
        />
        <Typography.Text>
          Расположите этикетку ровно, без бликов, чтобы QR занимал заметную часть кадра.
        </Typography.Text>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(event) => readFile(event.target.files?.[0])}
        />
        <Button
          type="primary"
          size="large"
          block
          icon={<CameraOutlined />}
          loading={reading}
          onClick={() => inputRef.current?.click()}
        >
          Сфотографировать QR-код
        </Button>
      </Space>
    </Modal>
  )
}
