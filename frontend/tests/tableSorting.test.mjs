import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { compareTableValues, withColumnSorting } from '../src/utils/tableSorting.js'
import { withColumnFilters } from '../src/utils/tableFilters.js'

const sorted = (rows, column, order = 'ascend') => [...rows].sort((a, b) => column.sorter(a, b, order) * (order === 'descend' ? -1 : 1))

test('Russian text, mixed case and embedded numbers sort naturally in both directions', () => {
  const rows = ['Яковлев', 'Принтер 10', 'абрамов', 'Принтер 2', 'Иванов'].map(name => ({ name }))
  const [column] = withColumnSorting([{ title: 'Имя', dataIndex: 'name' }], rows)
  assert.deepEqual(sorted(rows, column).map(row => row.name), ['абрамов', 'Иванов', 'Принтер 2', 'Принтер 10', 'Яковлев'])
  assert.deepEqual(sorted(rows, column, 'descend').map(row => row.name), ['Яковлев', 'Принтер 10', 'Принтер 2', 'Иванов', 'абрамов'])
})

test('numeric cells retain negative values, fractions, zero and empty cells last in either direction', () => {
  const rows = [null, 10, 2.5, -3, 0, 2].map(value => ({ value }))
  const [column] = withColumnSorting([{ title: 'Стоимость', dataIndex: 'value', render: value => value == null ? 'Не указан' : `${value.toLocaleString('ru')} ₽` }], rows)
  assert.deepEqual(sorted(rows, column).map(row => row.value), [-3, 0, 2, 2.5, 10, null])
  assert.deepEqual(sorted(rows, column, 'descend').map(row => row.value), [10, 2.5, 2, 0, -3, null])
  assert.ok(compareTableValues('1 000,25', '999,5') > 0)
  assert.ok(compareTableValues('−2,5', '0') < 0)
})

test('ISO and displayed dates sort chronologically across years with missing dates last', () => {
  const rows = ['2026-01-02', null, '2025-12-31', '2026-02-01'].map(date => ({ date }))
  const [column] = withColumnSorting([{ title: 'Дата', dataIndex: 'date', render: value => value || '—' }], rows)
  assert.deepEqual(sorted(rows, column).map(row => row.date), ['2025-12-31', '2026-01-02', '2026-02-01', null])
  assert.deepEqual(sorted(rows, column, 'descend').map(row => row.date), ['2026-02-01', '2026-01-02', '2025-12-31', null])
  assert.ok(compareTableValues('31.12.2025 23:59', '01.01.2026 00:01') < 0)
  assert.ok(compareTableValues('01.02.2026', '02.01.2026') > 0)
})

test('localized labels, nested fields and composite cells sort by visible content', () => {
  const rows = [
    { status: 'active', org: { name: 'Ярославль' }, count: 10 },
    { status: 'repair', org: { name: 'Архангельск' }, count: 2 },
  ]
  const columns = withColumnSorting([
    { title: 'Статус', dataIndex: 'status', render: value => createElement('span', {}, value === 'active' ? 'Рабочий' : 'В ремонте') },
    { title: 'Филиал', dataIndex: ['org', 'name'] },
    { title: 'Оборудование', key: 'count', render: (_, row) => row.count },
  ], rows)
  for (const column of columns) assert.equal(sorted(rows, column)[0], rows[1])
})

test('explicit sort values support computed counters and exclude extra buttons or date labels', () => {
  const rows = [{ count: 10 }, { count: 2 }, { count: null }]
  const [column] = withColumnSorting([{ title: 'Кол-во', key: 'count', sortValue: row => row.count,
    render: () => createElement('button', {}, 'Установить') }], rows)
  assert.deepEqual(sorted(rows, column).map(row => row.count), [2, 10, null])
  assert.equal(column.sortValue, undefined)
})

test('sorts the full filtered dataset before pagination without changing source order', () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ count: 60 - i, group: i % 2 ? 'Б' : 'А' }))
  const columns = withColumnFilters(withColumnSorting([
    { title: 'Кол-во', dataIndex: 'count' }, { title: 'Группа', dataIndex: 'group' },
  ], rows), rows)
  const filtered = rows.filter(row => columns[1].onFilter('А', row))
  assert.deepEqual(sorted(filtered, columns[0]).slice(0, 3).map(row => row.count), [2, 4, 6])
  assert.equal(rows[0].count, 60)
  assert.equal(rows.length, 60)
})

test('custom and server sorters, default sort and grouped columns remain supported; actions are never evaluated', () => {
  const custom = (a, b) => a.count - b.count
  let actionRenders = 0
  const columns = withColumnSorting([
    { title: 'Группа', children: [{ title: 'Имя', dataIndex: 'name' }] },
    { title: 'Своя сортировка', dataIndex: 'count', sorter: custom, defaultSortOrder: 'descend' },
    { title: 'Сервер', dataIndex: 'count', sorter: true },
    { title: 'Отключено', dataIndex: 'count', sorter: false },
    { title: '№', sortable: false, render: (_, __, index) => index + 1 },
    { title: 'Действия', key: 'actions', render: () => { actionRenders++; return null } },
  ], [{ name: 'Иван', count: 1 }])
  assert.equal(typeof columns[0].children[0].sorter, 'function')
  assert.equal(columns[1].sorter, custom)
  assert.equal(columns[1].defaultSortOrder, 'descend')
  assert.equal(columns[2].sorter, true)
  assert.equal(columns[3].sorter, false)
  assert.equal(columns[4].sorter, undefined)
  assert.equal(columns[5].sorter, undefined)
  assert.equal(actionRenders, 0)
})

test('long identifiers do not lose precision and equal values retain original order', () => {
  assert.ok(compareTableValues('12345678901234567892', '12345678901234567891') > 0)
  const rows = [{ id: 3, name: 'Иванов' }, { id: 1, name: 'иванов' }, { id: 2, name: 'ИВАНОВ' }]
  const [column] = withColumnSorting([{ title: 'Имя', dataIndex: 'name' }], rows)
  assert.deepEqual(sorted(rows, column).map(row => row.id), [3, 1, 2])
  assert.deepEqual(sorted(rows, column, 'descend').map(row => row.id), [3, 1, 2])
})
