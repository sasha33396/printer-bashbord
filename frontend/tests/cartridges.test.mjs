import test from 'node:test'
import assert from 'node:assert/strict'
import { actionAllowed, cartridgeSummary, cartridgeCompatibility, cartridgeMatchesAttention, cartridgeCycles, installationCandidates } from '../src/utils/cartridges.js'
import { barcodeTargetPath, barcodeValue } from '../src/utils/barcode.js'

test('ready reserves, installed and refilling cartridges never overlap in balances', () => {
  const base = { name: 'TK-1170', branch_id: 1, branch_name: 'Филиал', department_id: 2,
    department_name: 'Бухгалтерия', holder_type: 'employee', employee_id: 3, employee_name: 'Иванов' }
  const rows = [
    { ...base, state: 'ready' }, { ...base, state: 'ready' }, { ...base, state: 'installed' },
    { ...base, state: 'empty' }, { ...base, state: 'written_off' },
    { ...base, state: 'refilling', holder_type: 'contractor', employee_id: null, contractor: 'Сервис' },
  ]
  const groups = cartridgeSummary(rows)
  assert.equal(groups.length, 2)
  const employee = groups.find((row) => row.location.includes('Иванов'))
  assert.equal(employee.ready, 2)
  assert.equal(employee.installed, 1)
  assert.equal(employee.empty, 1)
  assert.equal(employee.total, 4)
  assert.equal(groups.find((row) => row.location === 'Заправка: Сервис').refilling, 1)
  const departments = cartridgeSummary(rows, 'department')
  assert.equal(departments.length, 1)
  assert.equal(departments[0].total, 5)
  assert.equal(departments[0].refilling, 1)
})

test('identical department names in different branches and employees keep separate balances', () => {
  const rows = [1, 2].map((branch_id) => ({ name: 'TK-1170', holder_type: 'department',
    branch_id, department_id: branch_id, department_name: 'Склад', state: 'ready' }))
  assert.equal(cartridgeSummary(rows).length, 2)
})

test('operations respect the cartridge lifecycle', () => {
  assert.equal(actionAllowed('send_refill', { state: 'installed' }), false)
  assert.equal(actionAllowed('send_refill', { state: 'empty' }), true)
  assert.equal(actionAllowed('return_refill', { state: 'refilling' }), true)
  assert.equal(actionAllowed('transfer', { state: 'refilling' }), false)
  assert.equal(actionAllowed('install', { state: 'ready' }), true)
  assert.equal(actionAllowed('write_off', { state: 'written_off' }), false)
})

test('cartridge labels use shared physical inventory numbers and support ID fallback', () => {
  assert.equal(barcodeValue('/cartridges/12', '1-00301'), '1-00301')
  assert.equal(barcodeValue('/cartridges/12'), 'PD-C-12')
  assert.equal(barcodeTargetPath('PD-C-12'), '/cartridges/12')
  assert.equal(barcodeTargetPath('PD-D-12'), '/devices/12')
})

test('installation offers compatible ready cartridges and explicitly optional unknown models', () => {
  const printer = { manufacturer: ' Kyocera ', model: ' ECOSYS   M2040dn' }
  const compatible = { item_id: 1, state: 'ready', compatible_models: [{ manufacturer: 'KYOCERA', model: 'ecosys m2040DN' }] }
  const mismatch = { item_id: 2, state: 'ready', compatible_models: [{ manufacturer: 'HP', model: 'M404dn' }] }
  const unknown = { item_id: 3, state: 'ready', compatible_printers: 'Kyocera (legacy description)' }
  const installed = { ...compatible, item_id: 4, state: 'installed' }
  assert.equal(cartridgeCompatibility(compatible, printer), 'compatible')
  assert.equal(cartridgeCompatibility(mismatch, printer), 'incompatible')
  assert.equal(cartridgeCompatibility(unknown, printer), 'unknown')
  assert.deepEqual(installationCandidates([compatible, mismatch, unknown, installed], printer).map(row => row.item_id), [1, 3])
  assert.deepEqual(installationCandidates([compatible, mismatch, unknown], printer, false).map(row => row.item_id), [1])
  assert.deepEqual(installationCandidates([compatible], null), [])
})

test('attention filters distinguish overdue, absent deadline, empty and unknown-duration cartridges', () => {
  const rows = [
    { item_id: 1, state: 'refilling', refill_overdue: true, expected_return_date: '2026-10-17' },
    { item_id: 2, state: 'refilling', refill_overdue: false, expected_return_date: '2026-10-18' },
    { item_id: 3, state: 'refilling', refill_overdue: false, expected_return_date: null },
    { item_id: 4, state: 'empty', state_days: 40 },
    { item_id: 5, state: 'installed', state_days: 31 },
    { item_id: 6, state: 'installed', state_days: 30 },
    { item_id: 7, state: 'installed', state_days: null },
  ]
  const filtered = (attention) => rows.filter(row => cartridgeMatchesAttention(row, attention, 30)).map(row => row.item_id)
  assert.deepEqual(filtered('overdue'), [1])
  assert.deepEqual(filtered('no_deadline'), [3])
  assert.deepEqual(filtered('empty'), [4])
  assert.deepEqual(filtered('installed_long'), [5])
  assert.equal(actionAllowed('refill_deadline', rows[0]), true)
  assert.equal(actionAllowed('refill_deadline', rows[4]), false)
})

test('resource history pairs same-day events by cartridge, device and slot and preserves zero and unknown values', () => {
  const event = { item_id: 1, device_id: 10, slot: 'Основной', date: '2026-10-18' }
  const cycles = cartridgeCycles([
    { ...event, id: 4, operation: 'remove', page_counter: 300, pages_printed: 0 },
    { ...event, id: 2, operation: 'remove', page_counter: 200, pages_printed: 100 },
    { ...event, id: 1, operation: 'install', page_counter: 100 },
    { ...event, id: 3, operation: 'install', page_counter: 300 },
    { ...event, item_id: 2, id: 5, operation: 'remove', page_counter: 500, pages_printed: null },
  ])
  assert.equal(cycles[0].initial_counter, null)
  assert.equal(cycles[0].pages_printed, null)
  assert.equal(cycles[1].initial_counter, 300)
  assert.equal(cycles[1].pages_printed, 0)
  assert.equal(cycles[2].initial_counter, 100)
  const inconsistent = cartridgeCycles([
    { ...event, id: 1, operation: 'install', page_counter: 100 },
    { ...event, id: 2, device_id: 11, operation: 'remove', page_counter: 200, pages_printed: null },
  ])
  assert.equal(inconsistent[0].installed_at, null)
  assert.equal(inconsistent[0].initial_counter, null)
})
