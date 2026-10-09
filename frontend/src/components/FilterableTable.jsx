import { useMemo, useState } from 'react'
import { Button, Input, Table, Tooltip } from 'antd'
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { cellText, withColumnFilters } from '../utils/tableFilters'

export default function FilterableTable({ columns = [], dataSource = [], locale, searchable = false, ...props }) {
  const [query, setQuery] = useState('')
  const [resetKey, setResetKey] = useState(0)
  const [hasFilters, setHasFilters] = useState(false)
  const filteredColumns = useMemo(() => withColumnFilters(columns, dataSource), [columns, dataSource])
  const visibleRows = useMemo(() => {
    const search = query.trim().toLocaleLowerCase('ru')
    if (!searchable || !search) return dataSource
    return dataSource.filter((row, index) => columns.some((column) => {
      if (column.key === 'actions' || !column.title) return false
      const path = Array.isArray(column.dataIndex) ? column.dataIndex : [column.dataIndex]
      const raw = path.reduce((value, key) => value?.[key], row)
      const value = column.render ? column.render(raw, row, index) : raw
      return cellText(value).toLocaleLowerCase('ru').includes(search)
    }))
  }, [dataSource, columns, query, searchable])
  const displayColumns = filteredColumns.map((column) => {
    if (!column.ellipsis) return column
    return { ...column, ellipsis: { showTitle: false }, render: (value, row, index) => {
      const content = column.render ? column.render(value, row, index) : value
      return <Tooltip title={cellText(content)}>{content ?? '—'}</Tooltip>
    } }
  })
  return <div className="data-table">
    {(searchable || hasFilters) && <div className="table-tools">
      {searchable && <Input aria-label="Поиск в таблице" prefix={<SearchOutlined />} placeholder="Поиск в таблице" allowClear value={query} onChange={(event) => setQuery(event.target.value)} />}
      {hasFilters && <Button size="small" icon={<ReloadOutlined />} onClick={() => { setResetKey((key) => key + 1); setHasFilters(false) }}>Сбросить фильтры таблицы</Button>}
    </div>}
    <Table size="small" {...props} key={resetKey} dataSource={visibleRows} columns={displayColumns}
      onChange={(pagination, filters, sorter, extra) => {
        setHasFilters(Object.values(filters).some((value) => value?.length))
        props.onChange?.(pagination, filters, sorter, extra)
      }} locale={{
    emptyText: 'Нет записей',
    filterTitle: 'Фильтр', filterConfirm: 'Применить', filterReset: 'Сбросить',
    filterSearchPlaceholder: 'Найти значение', filterEmptyText: 'Нет значений',
    filterCheckAll: 'Выбрать все', ...locale,
  }} />
  </div>
}

FilterableTable.Summary = Table.Summary
