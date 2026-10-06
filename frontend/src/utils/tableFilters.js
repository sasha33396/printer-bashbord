// Filter the text users see, including labels, dates and computed columns.
export function cellText(value) {
  if (value == null || typeof value === 'boolean') return ''
  if (Array.isArray(value)) return value.map(cellText).filter(Boolean).join(' ')
  if (typeof value === 'object') return cellText(value.props?.children)
  return String(value)
}

export function withColumnFilters(columns, rows) {
  return columns.map((column, index) => {
    const { filterValue, filterable, ...rest } = column
    if (column.children) return { ...rest, children: withColumnFilters(column.children, rows) }
    if (filterable === false || !column.title || column.filters || column.filterDropdown) return rest
    if (column.dataIndex == null && !column.render && !filterValue) return rest
    const getValue = (row, rowIndex) => {
      if (filterValue) return cellText(filterValue(row)).trim() || '—'
      const path = Array.isArray(column.dataIndex) ? column.dataIndex : [column.dataIndex]
      const raw = path.reduce((value, key) => value?.[key], row)
      return cellText(column.render ? column.render(raw, row, rowIndex) : raw).trim() || '—'
    }
    // Cache rendered values so filters never call action handlers or repeatedly render cells.
    const values = new Map(rows.map((row, rowIndex) => [row, getValue(row, rowIndex)]))
    const options = [...new Set(values.values())].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }))
    return {
      ...rest,
      key: column.key ?? (Array.isArray(column.dataIndex) ? column.dataIndex.join('.') : column.dataIndex) ?? `column-${index}`,
      filters: options.map((value) => ({ text: value, value })),
      filterSearch: (input, option) => option.text.toLocaleLowerCase('ru').includes(input.toLocaleLowerCase('ru')),
      onFilter: (value, row) => (values.get(row) ?? getValue(row)) === value,
    }
  })
}
