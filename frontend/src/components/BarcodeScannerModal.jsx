import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Modal, Space, Typography, message } from 'antd'
import { BarcodeOutlined, CameraOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { BrowserMultiFormatOneDReader } from '@zxing/browser'
import {
  BarcodeFormat, BinaryBitmap, DecodeHintType, GlobalHistogramBinarizer,
  HTMLCanvasElementLuminanceSource, MultiFormatOneDReader,
} from '@zxing/library'
import { barcodeTargetPath } from '../utils/barcode'

const hints = new Map()
hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128])
hints.set(DecodeHintType.TRY_HARDER, true)
const reader = new BrowserMultiFormatOneDReader(hints)
const globalReader = new MultiFormatOneDReader(hints)

const PHOTO_ATTEMPTS = [
  { crop: 1, angle: 0, maxSide: 3200 },
  { crop: 1, angle: 0, maxSide: 1800 },
  { crop: 1, angle: 0, maxSide: 1200 },
  { crop: 1, angle: 0, maxSide: 900, enhance: true },
  { crop: 0.9, angle: 0, maxSide: 1800 },
  { crop: 0.75, angle: 0, maxSide: 1400 },
  { crop: 0.9, angle: -5, maxSide: 1800 },
  { crop: 0.9, angle: 5, maxSide: 1800 },
  { crop: 1, angle: 90, maxSide: 1800 },
  { crop: 1, angle: -90, maxSide: 1800 },
]

function loadPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => resolve({ image, url })
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Телефон передал изображение в неподдерживаемом формате'))
    }
    image.src = url
  })
}

function photoCanvas(image, { crop: cropRatio, angle, maxSide, enhance = false }) {
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  if (!sourceWidth || !sourceHeight) throw new Error('Не удалось прочитать размер фотографии')

  const cropWidth = Math.max(1, Math.round(sourceWidth * cropRatio))
  const cropHeight = Math.max(1, Math.round(sourceHeight * cropRatio))
  const sourceX = Math.round((sourceWidth - cropWidth) / 2)
  const sourceY = Math.round((sourceHeight - cropHeight) / 2)
  const radians = angle * Math.PI / 180
  const scale = Math.min(1, maxSide / Math.max(cropWidth, cropHeight))
  const drawnWidth = Math.max(1, Math.round(cropWidth * scale))
  const drawnHeight = Math.max(1, Math.round(cropHeight * scale))
  const cos = Math.abs(Math.cos(radians))
  const sin = Math.abs(Math.sin(radians))
  const rotatedWidth = Math.ceil(drawnWidth * cos + drawnHeight * sin)
  const rotatedHeight = Math.ceil(drawnWidth * sin + drawnHeight * cos)
  const padding = Math.ceil(Math.max(rotatedWidth, rotatedHeight) * 0.06)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, rotatedWidth + padding * 2)
  canvas.height = Math.max(1, rotatedHeight + padding * 2)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Браузер не смог обработать фотографию')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate(radians)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  if (enhance) context.filter = 'grayscale(1) contrast(1.45) blur(0.35px)'
  context.drawImage(
    image,
    sourceX, sourceY, cropWidth, cropHeight,
    -drawnWidth / 2, -drawnHeight / 2, drawnWidth, drawnHeight,
  )
  return canvas
}

async function decodePhoto(file) {
  const { image, url } = await loadPhoto(file)
  let lastError
  try {
    for (const attempt of PHOTO_ATTEMPTS) {
      const canvas = photoCanvas(image, attempt)
      try {
        return reader.decodeFromCanvas(canvas).getText()
      } catch (error) {
        lastError = error
        try {
          const source = new HTMLCanvasElementLuminanceSource(canvas)
          const bitmap = new BinaryBitmap(new GlobalHistogramBinarizer(source))
          return globalReader.decode(bitmap, hints).getText()
        } catch (globalError) {
          lastError = globalError
        }
      } finally {
        // Освобождаем память между попытками — фотографии телефона бывают очень большими.
        canvas.width = 1
        canvas.height = 1
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    throw lastError || new Error('На фотографии не найден штрихкод')
  } finally {
    URL.revokeObjectURL(url)
  }
}

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
      openCard(await decodePhoto(file))
    } catch (error) {
      const notFound = error.name === 'NotFoundException'
        || error.name === 'ChecksumException'
        || error.name === 'FormatException'
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
