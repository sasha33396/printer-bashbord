import { useMemo } from 'react'
import { Table } from 'antd'
import { withColumnFilters } from '../utils/tableFilters'

export default function FilterableTable({ columns = [], dataSource = [], locale, ...props }) {
  const filteredColumns = useMemo(() => withColumnFilters(columns, dataSource), [columns, dataSource])
  return <Table {...props} dataSource={dataSource} columns={filteredColumns} locale={{
    filterTitle: 'Фильтр', filterConfirm: 'Применить', filterReset: 'Сбросить',
    filterSearchPlaceholder: 'Найти значение', filterEmptyText: 'Нет значений',
    filterCheckAll: 'Выбрать все', ...locale,
  }} />
}

FilterableTable.Summary = Table.Summary
