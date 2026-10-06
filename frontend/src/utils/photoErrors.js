export function photoErrorMessage(error, fallback) {
  const detail = error.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail)) {
    const text = detail.map((item) => item.msg).filter(Boolean).join('; ')
    if (text) return text
  }
  const status = error.response?.status
  if (status === 413) return 'Сервер отклонил загрузку из-за ограничения размера запроса (HTTP 413)'
  if (status) return `${fallback} (HTTP ${status})`
  if (error.code === 'ERR_NETWORK') return `${fallback}. Нет соединения с сервером`
  return fallback
}
