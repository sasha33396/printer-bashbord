import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { withColumnFilters } from '../src/utils/tableFilters.js'
import { equipmentLocation, deviceLocation } from '../src/utils/equipmentLocation.js'

test('multiple column filters combine before pagination and include blank inventory numbers', () => {
  const rows = Array.from({ length: 60 }, (_, index) => ({
    inventory_number: index === 59 ? '1-00270' : null,
    location: index >= 50 ? 'Серверная стойка' : 'Офис',
  }))
  const columns = withColumnFilters([
    { title: '№', dataIndex: 'inventory_number' }, { title: 'Место', dataIndex: 'location' },
  ], rows)
  const selected = rows.filter((row) => columns[0].onFilter('—', row) && columns[1].onFilter('Серверная стойка', row))
  assert.equal(selected.length, 9)
  assert.ok(columns[0].filters.some((option) => option.value === '1-00270'))
  assert.ok(columns[1].filterSearch('СТОЙКА', { text: 'Серверная стойка' }))
})

test('computed paths and rendered Russian labels are filterable; actions are never evaluated', () => {
  let actionRenders = 0
  const rows = [
    { placement: 'Рабочее место', workplace: { name: 'Стойка', location: 'Серверная' }, status: 'active' },
    { placement: 'Склад/серверная', branch: { name: 'Техкомплект' }, status: 'repair' },
  ]
  const columns = withColumnFilters([
    { title: 'Место', key: 'path', render: (_, row) => equipmentLocation(row) },
    { title: 'Статус', dataIndex: 'status', render: (value) => createElement('span', {}, value === 'active' ? 'Рабочий' : 'В ремонте') },
    { title: '', key: 'actions', render: () => { actionRenders += 1; return null } },
  ], rows)
  assert.equal(actionRenders, 0)
  assert.equal(columns[2].filters, undefined)
  assert.ok(columns[0].onFilter('Рабочее место / Стойка / Серверная', rows[0]))
  assert.ok(columns[1].onFilter('В ремонте', rows[1]))
  assert.equal(columns[1].onFilter('repair', rows[1]), false)
})

test('filter options preserve zero values, deduplicate and sort numbers naturally', () => {
  const [column] = withColumnFilters([{ title: 'Кол-во', dataIndex: 'quantity' }], [
    { quantity: 10 }, { quantity: 2 }, { quantity: 0 }, { quantity: 2 },
  ])
  assert.deepEqual(column.filters.map((option) => option.value), ['0', '2', '10'])
})

test('existing server filters and sorters remain intact', () => {
  const dropdown = () => null
  const sorter = (a, b) => a.count - b.count
  const columns = withColumnFilters([
    { title: 'История', filterDropdown: dropdown },
    { title: 'Количество', dataIndex: 'count', sorter },
    { title: '№ строки', filterable: false, render: (_, __, index) => index + 1 },
  ], [{ count: 3 }])
  assert.equal(columns[0].filterDropdown, dropdown)
  assert.equal(columns[0].onFilter, undefined)
  assert.equal(columns[1].sorter, sorter)
  assert.equal(columns[2].filters, undefined)
  assert.equal(columns[2].filterable, undefined)
})

test('paths use current location, retain meaningful segments and show missing data explicitly', () => {
  assert.equal(equipmentLocation({ placement: 'Рабочее место', workplace: { name: 'Серверная стойка' } }), 'Рабочее место / Серверная стойка')
  assert.equal(equipmentLocation({ placement: 'Склад/серверная', branch: { name: 'Саратов' }, department: { name: 'IT' } }), 'Склад/серверная / Саратов / IT')
  assert.equal(equipmentLocation({ placement: 'Не определено' }), 'Не определено')
  assert.equal(equipmentLocation({}), '—')
  assert.equal(deviceLocation({ department: { name: 'IT', branch: { name: 'Саратов' } }, location: '205' }), 'Саратов / IT / 205')
})
