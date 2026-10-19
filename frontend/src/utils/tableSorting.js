import { cellText } from './tableFilters.js'

const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' })
const rawValue = (column, row) => (Array.isArray(column.dataIndex) ? column.dataIndex : [column.dataIndex])
  .reduce((value, key) => value?.[key], row)
const isoDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) && Number.isFinite(Date.parse(value))

function comparable(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const text = cellText(value).trim()
  if (!text || text === '—') return null
  if (isoDate(text)) return Date.parse(text)
  // Computed cells can contain a formatted date rather than a dataIndex.
  const date = text.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  if (date) return Date.UTC(+date[3], +date[2] - 1, +date[1], +(date[4] || 0), +(date[5] || 0), +(date[6] || 0))
  const number = text.replace(/[\s\u202f]/g, '').replace(/−/g, '-').replace(',', '.')
  if (/^[+-]?\d+(?:\.\d+)?$/.test(number) && (number.includes('.') || Number.isSafeInteger(Number(number)))) return Number(number)
  return text
}

// Ant Design reverses the comparator for descending order. Compensate only for
// missing values so empty cells stay last in either direction.
export function compareTableValues(left, right, order = 'ascend') {
  const a = comparable(left), b = comparable(right)
  if (a == null || b == null) {
    if (a == null && b == null) return 0
    return (a == null ? 1 : -1) * (order === 'descend' ? -1 : 1)
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return collator.compare(String(a), String(b))
}

export function withColumnSorting(columns, rows) {
  return columns.map((column, index) => {
    const { sortable, sortValue, ...rest } = column
    if (column.children) return { ...rest, children: withColumnSorting(column.children, rows) }
    if (sortable === false || column.key === 'actions' || !column.title || column.sorter != null) return rest
    if (column.dataIndex == null && !column.render && !sortValue) return rest
    // Keep numbers and dates typed, even when the cell includes a unit or label.
    // Other columns sort by the visible Russian text rather than internal codes.
    const useRaw = column.dataIndex != null && rows.some((row) => {
      const value = rawValue(column, row)
      return typeof value === 'number' || isoDate(value)
    })
    const getValue = (row, rowIndex) => {
      if (sortValue) return sortValue(row)
      const value = rawValue(column, row)
      if (useRaw) return value
      if (column.filterValue) return column.filterValue(row)
      return column.render ? column.render(value, row, rowIndex) : value
    }
    const values = new Map(rows.map((row, rowIndex) => [row, getValue(row, rowIndex)]))
    return {
      ...rest,
      key: column.key ?? (Array.isArray(column.dataIndex) ? column.dataIndex.join('.') : column.dataIndex) ?? `column-${index}`,
      sorter: (a, b, order) => compareTableValues(values.has(a) ? values.get(a) : getValue(a), values.has(b) ? values.get(b) : getValue(b), order),
    }
  })
}
