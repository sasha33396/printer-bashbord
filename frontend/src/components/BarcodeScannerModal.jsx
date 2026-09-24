import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Modal, Space, Typography, message } from 'antd'
import { BarcodeOutlined, CameraOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { BrowserMultiFormatOneDReader } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import { barcodeTargetPath } from '../utils/barcode'

const hints = new Map()
hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128])
hints.set(DecodeHintType.TRY_HARDER, true)
const reader = new BrowserMultiFormatOneDReader(hints)

export default function BarcodeScannerModal({ open, onClose }) {
  const inputRef = useRef(null)
  const navigate = useNavigate()
  const [reading, setReading] = useState(false)
  const [code, setCode] = useState('')

  useEffect(() => {
    if (open) setCode('')
  }, [open])

  const openCard = (value) => {
    const path = barcodeTargetPath(value)
    if (!path) throw new Error('Это не штрихкод Printer Dashboard')
    onClose()
    navigate(path)
  }

  const readFile = async (file) => {
    if (!file) return
    setReading(true)
    try {
      const bitmap = await createImageBitmap(file)
      const canvas = document.createElement('canvas')
      const maxSide = 2400
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close?.()
      const result = reader.decodeFromCanvas(canvas)
      openCard(result.getText())
    } catch (error) {
      const notFound = error.name === 'NotFoundException'
        || String(error.message || '').includes('detect the code')
      message.error(notFound
        ? 'На фотографии не найден штрихкод'
        : error.message || 'Не удалось распознать штрихкод')
    } finally {
      setReading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const submitCode = (value = code) => {
    try {
      openCard(value)
    } catch (error) {
      message.error(error.message)
    }
  }

  return (
    <Modal title="Поиск по штрихкоду" open={open} onCancel={onClose} footer={null} destroyOnClose>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="Сканирование работает по HTTP"
          description="На телефоне сфотографируйте штрихкод. Можно также использовать ручной сканер как клавиатуру."
        />
        <Typography.Text>
          Штрихкод должен целиком попадать в кадр, без бликов и сильного наклона.
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
          Сфотографировать штрихкод
        </Button>
        <Input.Search
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onSearch={submitCode}
          enterButton={<BarcodeOutlined />}
          placeholder="PD-D-123 — ввод или ручной сканер"
          size="large"
          autoFocus
        />
      </Space>
    </Modal>
  )
}
