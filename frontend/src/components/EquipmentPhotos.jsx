import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Empty, Image, Popconfirm, Spin, message } from 'antd'
import { CameraOutlined, DeleteOutlined, SnippetsOutlined } from '@ant-design/icons'
import api from '../api/api'
import { photoErrorMessage } from '../utils/photoErrors'

export default function EquipmentPhotos({ itemId, resourcePath }) {
  const inputRef = useRef(null)
  const urlsRef = useRef([])
  const requestRef = useRef(0)
  const uploadRef = useRef(false)
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const photosPath = resourcePath || `/warehouse/items/${itemId}/photos`

  const revokeUrls = useCallback(() => {
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    urlsRef.current = []
  }, [])

  const load = useCallback(async () => {
    const request = ++requestRef.current
    setLoading(true)
    try {
      const { data } = await api.get(photosPath)
      const hydrated = await Promise.all(data.map(async (photo) => {
        const response = await api.get(
          `${photosPath}/${encodeURIComponent(photo.filename)}`,
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
        message.error(photoErrorMessage(error, 'Не удалось загрузить фотографии'))
      }
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [photosPath, revokeUrls])

  useEffect(() => {
    load()
    return () => {
      requestRef.current += 1
      revokeUrls()
    }
  }, [load, revokeUrls])

  const uploadFiles = async (files) => {
    if (!files.length) return
    if (uploadRef.current || loading || deleting) {
      message.info('Дождитесь завершения текущей операции с фотографиями')
      return
    }
    if (files.some((file) => file.type && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
      message.error('Поддерживаются фотографии JPEG, PNG и WebP')
      return
    }
    if (files.some((file) => file.size > 10 * 1024 * 1024)) {
      message.error('Размер одной фотографии не должен превышать 10 МБ')
      return
    }
    if (photos.length + files.length > 10) {
      message.error('Для одного оборудования можно сохранить не более 10 фотографий')
      return
    }
    const form = new FormData()
    files.forEach((file) => form.append('files', file))
    uploadRef.current = true
    setUploading(true)
    try {
      await api.post(photosPath, form)
      message.success(files.length === 1 ? 'Фотография добавлена' : 'Фотографии добавлены')
      await load()
    } catch (error) {
      message.error(photoErrorMessage(error, 'Не удалось добавить фотографии'))
    } finally {
      uploadRef.current = false
      setUploading(false)
    }
  }

  const upload = (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    uploadFiles(files)
  }

  const paste = (event) => {
    const clipboard = event.clipboardData
    const items = Array.from(clipboard?.items || [])
    const files = (items.length
      ? items.filter((item) => item.kind === 'file').map((item) => item.getAsFile())
      : Array.from(clipboard?.files || []))
      .filter((file) => file?.type.startsWith('image/'))
    if (!files.length) return
    event.preventDefault()
    event.stopPropagation()
    uploadFiles(files)
  }

  const remove = async (photo) => {
    setDeleting(photo.filename)
    try {
      await api.delete(`${photosPath}/${encodeURIComponent(photo.filename)}`)
      message.success('Фотография удалена')
      await load()
    } catch (error) {
      message.error(photoErrorMessage(error, 'Не удалось удалить фотографию'))
    } finally {
      setDeleting(null)
    }
  }

  return <div className="equipment-photos" onPaste={paste}>
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
        disabled={loading || Boolean(deleting)}
        onClick={() => inputRef.current?.click()}
      >
        Добавить фото
      </Button>
    </div>

    <button
      type="button"
      className="equipment-photo-paste"
      aria-disabled={loading || uploading || Boolean(deleting)}
      onClick={(event) => event.currentTarget.focus()}
    >
      <SnippetsOutlined aria-hidden="true" />
      <span>{uploading ? 'Фотография загружается…' : 'Нажмите здесь и Ctrl+V, чтобы вставить фото'}</span>
      <small>Скопируйте изображение или сделайте снимок экрана</small>
    </button>

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
                  disabled={uploading || loading || Boolean(deleting && deleting !== photo.filename)}
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
