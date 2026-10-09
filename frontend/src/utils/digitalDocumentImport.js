import { documentTitle } from './digitalDocuments.js'

export const IMPORT_STATUSES = {
  new: { label: 'Будет добавлено', color: 'green' },
  created: { label: 'Добавлено', color: 'green' },
  unchanged: { label: 'Уже есть / повтор', color: 'default' },
  error: { label: 'Ошибка', color: 'red' },
  conflict: { label: 'Нужно сверить', color: 'orange' },
}

export function importReportSummary(report) {
  const totals = report.totals
  const issues = totals.error + totals.conflict
  const created = totals.created || 0
  const type = report.applied ? issues ? 'warning' : 'success' : report.can_apply ? issues ? 'warning' : 'info' : issues ? 'error' : 'info'
  const title = report.applied
    ? issues ? 'Корректные записи добавлены. Остальные требуют исправления' : 'Импорт завершён'
    : report.can_apply ? issues ? 'Можно добавить корректные записи, остальные останутся в отчёте' : 'Файл проверен'
      : issues ? 'Нет корректных новых записей для добавления' : 'Новых записей нет'
  return { type, title, description: `${report.applied ? 'Добавлено' : 'Новых'}: ${report.applied ? created : totals.new}; уже есть / повторов: ${totals.unchanged}; ошибок: ${totals.error}; нужно сверить: ${totals.conflict}.` }
}

export function importRowTitle(row) {
  return documentTitle(row.kind, row.data || row.source_data || {}) || '—'
}

export function importReportPayload(report, filename) {
  return { mode: report.mode, rows: report.rows.map((row) => row.data ? { ...row, source_data: {} } : row),
    warnings: report.warnings, source_filename: filename }
}
