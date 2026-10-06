import { Button, Input, Select, Space } from 'antd'
import { SearchOutlined } from '@ant-design/icons'

// Server-paginated tables must filter the whole dataset before pagination.
export function serverTextFilter(value, onChange, label) {
  return {
    filteredValue: value ? [value] : null,
    filterIcon: (active) => <SearchOutlined style={{ color: active ? '#1677ff' : undefined }} />,
    filterDropdown: ({ selectedKeys, setSelectedKeys, confirm }) => {
      const apply = () => { onChange(String(selectedKeys[0] || '').trim() || undefined); confirm() }
      return <div style={{ padding: 12, width: 260 }} onKeyDown={(event) => event.stopPropagation()}>
        <Input autoFocus aria-label={`Фильтр: ${label}`} placeholder={`Поиск: ${label}`} allowClear
          value={selectedKeys[0] || ''} onChange={(event) => setSelectedKeys(event.target.value ? [event.target.value] : [])}
          onPressEnter={apply} style={{ marginBottom: 8 }} />
        <Space>
          <Button type="primary" size="small" onClick={apply}>Применить</Button>
          <Button size="small" onClick={() => { setSelectedKeys([]); onChange(undefined); confirm() }}>Сбросить</Button>
        </Space>
      </div>
    },
  }
}

export function serverChoiceFilter(value, onChange, options, label) {
  return {
    filteredValue: value ? [value] : null,
    filterDropdown: ({ confirm }) => <div style={{ padding: 12 }}>
      <Select style={{ width: 240 }} aria-label={`Фильтр: ${label}`} placeholder="Все значения"
        allowClear showSearch optionFilterProp="label" value={value} options={options}
        onChange={(next) => { onChange(next); confirm() }} />
    </div>,
  }
}
