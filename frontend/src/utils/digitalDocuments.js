import dayjs from 'dayjs'

export const TERM_STATUS = {
  not_started: { label: 'Срок не начался', color: 'blue' },
  valid: { label: 'Срок действует', color: 'green' },
  expiring: { label: 'Скоро истекает', color: 'orange' },
  expired: { label: 'Срок истёк', color: 'red' },
}

const text = (key, label, options = {}) => ({ key, label, type: 'text', maxLength: 255, width: 190, ...options })
const identifier = (key, label, options = {}) => text(key, label, { copyable: true, ...options })
const inn = (key, label) => identifier(key, label, { maxLength: 32, width: 155 })
const snils = (key, label) => identifier(key, label, { maxLength: 32, width: 170 })
const date = (key, label) => ({ key, label, type: 'date', required: true, width: 165 })

export const DOCUMENTS = {
  ecp: {
    label: 'ЭЦП', singular: 'ЭЦП', endpoint: '/digital-documents/signatures',
    titleKey: 'company_name',
    fields: [
      text('company_name', 'Название компании', { required: true, maxLength: 500, width: 230 }),
      inn('inn', 'ИНН'),
      text('certificate_type', 'Тип'),
      text('signature_kind', 'Вид подписи'),
      text('full_name', 'ФИО', { required: true, width: 230 }),
      text('position', 'Должность'),
      snils('snils', 'СНИЛС'),
      text('email', 'Email', { email: true, copyable: true }),
      text('application', 'Применение', { type: 'multiline', maxLength: 10000, width: 240 }),
      date('valid_from', 'Действителен с'),
      date('valid_to', 'Действителен по'),
      text('ep_state', 'Состояние ЭП'),
      { key: 'revoked_at', label: 'Дата и время отзыва', type: 'datetime', width: 200 },
      identifier('fingerprint', 'Отпечаток', { maxLength: 512, width: 260 }),
      identifier('serial_number', 'Серийный номер', { width: 220 }),
    ],
  },
  mchd: {
    label: 'МЧД', singular: 'МЧД', endpoint: '/digital-documents/powers-of-attorney',
    titleKey: 'power_number',
    fields: [
      identifier('power_number', 'Номер доверенности', { required: true, width: 220 }),
      date('valid_from', 'Дата начала действия'),
      date('valid_to', 'Дата окончания действия'),
      inn('grantor_inn', 'ИНН доверителя'),
      text('grantor_name', 'Наименование доверителя', { required: true, maxLength: 500, width: 230 }),
      text('grantor_person_full_name', 'ФИО лица доверителя', { width: 230 }),
      inn('grantor_person_inn', 'ИНН лица доверителя'),
      snils('grantor_person_snils', 'СНИЛС лица доверителя'),
      text('representative_full_name', 'ФИО лица представителя', { required: true, width: 230 }),
      inn('representative_inn', 'ИНН лица представителя'),
      snils('representative_snils', 'СНИЛС лица представителя'),
      text('permissions', 'Разрешения', { type: 'multiline', maxLength: 10000, width: 270 }),
      identifier('fns_identifier', 'Идентификатор МЧД ФНС', { width: 270 }),
      identifier('edo_identifier', 'Идентификатор МЧД ЭДО', { width: 270 }),
      text('edo_status', 'Статус МЧД ЭДО'),
    ],
  },
}

export function documentTitle(kind, row) {
  return kind === 'ecp'
    ? [row.company_name, row.full_name].filter(Boolean).join(' · ')
    : [row.power_number, row.grantor_name].filter(Boolean).join(' · ')
}

export function displayField(field, value) {
  if (value == null || value === '') return '—'
  if (field.type === 'date') return dayjs(value).format('DD.MM.YYYY')
  if (field.type === 'datetime') return dayjs(value).format('DD.MM.YYYY HH:mm:ss')
  return String(value)
}

export function documentPayload(fields, values) {
  return Object.fromEntries(fields.map((field) => {
    const value = values[field.key]
    if (field.type === 'date') return [field.key, value ? value.format('YYYY-MM-DD') : null]
    if (field.type === 'datetime') return [field.key, value ? value.toISOString() : null]
    return [field.key, typeof value === 'string' ? value.trim() || null : value ?? null]
  }))
}

export function documentFieldRules(field) {
  const rules = []
  if (field.required) rules.push({ required: true,
    ...(field.type === 'date' ? { type: 'object' } : { whitespace: true }),
    message: `Заполните поле «${field.label}»`,
  })
  if (field.email) rules.push({ pattern: /^[^@\s]+@[^@\s]+\.[^@\s]+$/, message: 'Укажите корректный Email' })
  return rules
}

export function documentMatches(config, row, query) {
  const normalized = query.trim().toLocaleLowerCase('ru')
  return !normalized || config.fields.some((field) => [row[field.key], displayField(field, row[field.key])]
    .some((value) => value != null && String(value).toLocaleLowerCase('ru').includes(normalized)))
}

export function documentError(error, fallback) {
  const detail = error.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map((item) => item.msg).filter(Boolean).join('; ') || fallback
  return fallback
}
