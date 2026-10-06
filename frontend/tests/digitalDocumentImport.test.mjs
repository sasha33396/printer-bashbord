import assert from 'node:assert/strict'
import test from 'node:test'
import { importReportPayload, importReportSummary, importRowTitle } from '../src/utils/digitalDocumentImport.js'

test('partial preview permits correct rows and explains that errors remain', () => {
  const summary = importReportSummary({ can_apply: true, applied: false, totals: { new: 171, unchanged: 4, error: 3, conflict: 1 } })
  assert.equal(summary.type, 'warning')
  assert.ok(summary.title.includes('Можно добавить'))
  assert.ok(summary.description.includes('Новых: 171'))
})

test('partial apply counts committed records and retains unresolved totals', () => {
  const summary = importReportSummary({ can_apply: true, applied: true, totals: { new: 0, created: 171, unchanged: 4, error: 3, conflict: 1 } })
  assert.equal(summary.type, 'warning')
  assert.ok(summary.description.includes('Добавлено: 171'))
  assert.ok(summary.description.includes('ошибок: 3; нужно сверить: 1'))
})

test('all-duplicate and all-error reports explain why there is nothing to apply', () => {
  assert.equal(importReportSummary({ can_apply: false, applied: false, totals: { new: 0, unchanged: 10, error: 0, conflict: 0 } }).title, 'Новых записей нет')
  assert.equal(importReportSummary({ can_apply: false, applied: false, totals: { new: 0, unchanged: 0, error: 3, conflict: 1 } }).type, 'error')
})

test('invalid rows retain source names and exported reports use the displayed results', () => {
  const row = { kind: 'ecp', row: 4, status: 'error', data: null, source_data: { company_name: 'Компания', full_name: 'Иванов', inn: '0001234567' } }
  assert.equal(importRowTitle(row), 'Компания · Иванов')
  const report = { mode: 'apply', rows: [row], warnings: ['Предупреждение'], totals: { new: 0 } }
  const payload = importReportPayload(report, 'Исходник.xlsx')
  assert.equal(payload.source_filename, 'Исходник.xlsx')
  assert.equal(payload.rows[0].source_data.inn, '0001234567')
  assert.equal(payload.mode, 'apply')
  assert.deepEqual(payload.rows, report.rows)
  const valid = { ...row, status: 'created', data: { inn: '0001234567' } }
  const exported = importReportPayload({ ...report, rows: [valid] }, 'Исходник.xlsx')
  assert.deepEqual(exported.rows[0].source_data, {})
  assert.equal(exported.rows[0].data.inn, '0001234567')
})
