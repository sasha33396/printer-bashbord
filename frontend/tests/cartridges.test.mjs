import test from 'node:test'
import assert from 'node:assert/strict'
import { actionAllowed, cartridgeSummary } from '../src/utils/cartridges.js'
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
