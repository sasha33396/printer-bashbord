import assert from 'node:assert/strict'
import test from 'node:test'
import { expiringDocuments, groupCounts, inventoryAssets } from '../src/utils/overview.js'

test('overview counts individual assets once and excludes consumable quantities and archived items', () => {
  const assets = inventoryAssets([{ id: 1, department: { branch: { name: 'Москва' } } }], [
    { id: 1, tracking_type: 'asset', category: 'Компьютеры', branch: { name: 'Москва' } },
    { id: 2, tracking_type: 'quantity', category: 'Картриджи', current_quantity: 500 },
    { id: 3, tracking_type: 'asset', is_archived: true },
  ])
  assert.equal(assets.length, 2)
  assert.deepEqual(groupCounts(assets, (row) => row.branch?.name), [{ label: 'Москва', count: 2 }])
  assert.deepEqual(groupCounts(assets, (row) => row.category), [
    { label: 'Печатающая техника', count: 1 }, { label: 'Компьютеры', count: 1 },
  ])
})

test('document expiry follows server status and excludes archived and expired records', () => {
  const rows = expiringDocuments([
    { id: 1, term_status: 'expiring', full_name: 'Иванов', valid_to: '2026-10-20', inn: '00123' },
    { id: 2, term_status: 'expired', valid_to: '2026-10-01' },
    { id: 3, term_status: 'expiring', is_archived: true, valid_to: '2026-10-11' },
    { id: 4, term_status: 'valid', valid_to: '2027-10-01' },
  ], [{ id: 1, term_status: 'expiring', representative_full_name: 'Петров', valid_to: '2026-10-15' }])
  assert.deepEqual(rows.map((row) => [row.kind, row.id, row.owner]), [['mchd', 1, 'Петров'], ['ecp', 1, 'Иванов']])
  assert.equal(rows[1].inn, '00123')
})

test('empty datasets and missing branch locations have explicit representations', () => {
  assert.deepEqual(inventoryAssets([], []), [])
  assert.deepEqual(expiringDocuments([], []), [])
  assert.deepEqual(groupCounts([{ branch: null }], (row) => row.branch?.name), [{ label: 'Не указан', count: 1 }])
})
