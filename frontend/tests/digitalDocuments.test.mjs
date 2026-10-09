import assert from 'node:assert/strict'
import test from 'node:test'
import dayjs from 'dayjs'
import asyncValidator from '@rc-component/async-validator'
import { DOCUMENTS, displayField, documentFieldRules, documentMatches, documentPayload } from '../src/utils/digitalDocuments.js'

const Schema = asyncValidator.default ?? asyncValidator

test('both registers expose all fifteen distinct requested fields', () => {
  for (const config of Object.values(DOCUMENTS)) {
    assert.equal(config.fields.length, 15)
    assert.equal(new Set(config.fields.map((field) => field.key)).size, 15)
    assert.ok(config.fields.some((field) => field.key === 'valid_from' && field.required))
    assert.ok(config.fields.some((field) => field.key === 'valid_to' && field.required))
  }
})

test('Ant Design form validation accepts selected Dayjs dates and rejects missing dates', async () => {
  for (const config of Object.values(DOCUMENTS)) {
    for (const field of config.fields.filter((item) => item.type === 'date')) {
      const schema = new Schema({ [field.key]: documentFieldRules(field) })
      await schema.validate({ [field.key]: dayjs('2026-10-06') })
      await assert.rejects(schema.validate({ [field.key]: null }))
    }
  }
})

test('Ant Design validation rejects whitespace-only mandatory names and malformed email', async () => {
  const company = DOCUMENTS.ecp.fields.find((field) => field.key === 'company_name')
  const email = DOCUMENTS.ecp.fields.find((field) => field.key === 'email')
  const schema = new Schema({ company_name: documentFieldRules(company), email: documentFieldRules(email) })
  await schema.validate({ company_name: 'Компания', email: '' })
  await assert.rejects(schema.validate({ company_name: ' ', email: '' }))
  await assert.rejects(schema.validate({ company_name: 'Компания', email: 'broken' }))
})

test('form submission preserves textual identifiers, date-only values and explicitly cleared optional fields', () => {
  const payload = documentPayload(DOCUMENTS.ecp.fields, {
    company_name: ' Компания ', full_name: ' Иванов ', inn: '0012345678', snils: '001-002-003 04',
    serial_number: '00000123', email: '', valid_from: dayjs('2026-10-01'), valid_to: dayjs('2027-10-01'),
    revoked_at: dayjs('2026-10-06T14:30:15+04:00'),
  })
  assert.equal(payload.company_name, 'Компания')
  assert.equal(payload.inn, '0012345678')
  assert.equal(payload.serial_number, '00000123')
  assert.equal(payload.valid_from, '2026-10-01')
  assert.equal(payload.valid_to, '2027-10-01')
  assert.equal(payload.revoked_at, '2026-10-06T10:30:15.000Z')
  assert.equal(payload.email, null)
  assert.equal(payload.fingerprint, null)
  assert.equal(payload.snils, '001-002-003 04')
})

test('permissions remain multiline and all MCHD identities stay separate', () => {
  const values = { power_number: '000001', permissions: 'Разрешение 1\nРазрешение 2', grantor_inn: '0012345678',
    grantor_person_inn: '001111111111', representative_inn: '002222222222', fns_identifier: '000-FNS', edo_identifier: '000-EDO' }
  const payload = documentPayload(DOCUMENTS.mchd.fields, values)
  for (const [field, value] of Object.entries(values)) assert.equal(payload[field], value)
})

test('search includes long permissions, literal identifiers, Cyrillic names and displayed calendar dates', () => {
  const config = DOCUMENTS.mchd
  const row = { power_number: '000001', grantor_name: 'ООО Компания', valid_from: '2026-10-01',
    permissions: 'Получать сведения\nПодписывать документы', edo_identifier: '000_ЭДО%' }
  assert.ok(documentMatches(config, row, 'КОМПАНИЯ'))
  assert.ok(documentMatches(config, row, 'подписывать'))
  assert.ok(documentMatches(config, row, '01.10.2026'))
  assert.ok(documentMatches(config, row, '000_ЭДО%'))
  assert.ok(documentMatches(config, row, '   '))
  assert.equal(documentMatches(config, row, 'чужой номер'), false)
  assert.equal(displayField(config.fields.find((field) => field.key === 'valid_from'), row.valid_from), '01.10.2026')
})
