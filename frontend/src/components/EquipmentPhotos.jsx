import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Empty, Image, Popconfirm, Spin, message } from 'antd'
import { CameraOutlined, DeleteOutlined } from '@ant-design/icons'
import api from '../api/api'

const errorMessage = (error, fallback) => {
  const detail = error.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}

export default function EquipmentPhotos({ itemId }) {
  const inputRef = useRef(null)
  const urlsRef = useRef([])
  const requestRef = useRef(0)
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState(null)

  const revokeUrls = useCallback(() => {
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    urlsRef.current = []
  }, [])

  const load = useCallback(async () => {
    const request = ++requestRef.current
    setLoading(true)
    try {
      const { data } = await api.get(`/warehouse/items/${itemId}/photos`)
      const hydrated = await Promise.all(data.map(async (photo) => {
        const response = await api.get(
          `/warehouse/items/${itemId}/photos/${encodeURIComponent(photo.filename)}`,
          { responseType: 'blob' },
        )
        return { ...photo, url: URL.createObjectURL(response.data) }
      }))
      if (request !== requestRef.current) {
        hydrated.forEach((photo) => URL.revokeObjectURL(photo.url))
        return
      }
      revokeUrls()
      urlsRef.current = hydrated.map((photo) => photo.url)
      setPhotos(hydrated)
    } catch (error) {
      if (request === requestRef.current) {
        message.error(errorMessage(error, 'Не удалось загрузить фотографии'))
      }
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [itemId, revokeUrls])

  useEffect(() => {
    load()
    return () => {
      requestRef.current += 1
      revokeUrls()
    }
  }, [load, revokeUrls])

  const upload = async (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    const form = new FormData()
    files.forEach((file) => form.append('files', file))
    setUploading(true)
    try {
      await api.post(`/warehouse/items/${itemId}/photos`, form)
      message.success(files.length === 1 ? 'Фотография добавлена' : 'Фотографии добавлены')
      await load()
    } catch (error) {
      message.error(errorMessage(error, 'Не удалось добавить фотографии'))
    } finally {
      setUploading(false)
    }
  }

  const remove = async (photo) => {
    setDeleting(photo.filename)
    try {
      await api.delete(`/warehouse/items/${itemId}/photos/${encodeURIComponent(photo.filename)}`)
      message.success('Фотография удалена')
      await load()
    } catch (error) {
      message.error(errorMessage(error, 'Не удалось удалить фотографию'))
    } finally {
      setDeleting(null)
    }
  }

  return <div className="equipment-photos">
    <div className="equipment-photos-header">
      <div>
        <h2>Фотографии</h2>
        <p>До 10 файлов JPEG, PNG или WebP, не более 10 МБ каждый</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={upload}
      />
      <Button
        icon={<CameraOutlined />}
        loading={uploading}
        onClick={() => inputRef.current?.click()}
      >
        Добавить фото
      </Button>
    </div>

    {loading ? (
      <div className="equipment-photos-loading"><Spin /></div>
    ) : photos.length === 0 ? (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Фотографий пока нет" />
    ) : (
      <Image.PreviewGroup>
        <div className="equipment-photo-grid">
          {photos.map((photo) => (
            <div className="equipment-photo" key={photo.filename}>
              <Image src={photo.url} alt="Оборудование" />
              <Popconfirm
                title="Удалить фотографию?"
                okText="Удалить"
                cancelText="Отмена"
                onConfirm={() => remove(photo)}
              >
                <Button
                  className="equipment-photo-delete"
                  danger
                  shape="circle"
                  size="small"
                  icon={<DeleteOutlined />}
                  loading={deleting === photo.filename}
                  aria-label="Удалить фотографию"
                />
              </Popconfirm>
            </div>
          ))}
        </div>
      </Image.PreviewGroup>
    )}
  </div>
}
