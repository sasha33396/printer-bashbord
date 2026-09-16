import { Typography, Tabs } from 'antd'
import Repairs from './Repairs'
import Consumables from './Consumables'
import Orgs from './Orgs'

const items = [
  { key: 'orgs',        label: 'Организации', children: <Orgs /> },
  { key: 'consumables', label: 'Расходники',  children: <Consumables /> },
  { key: 'repairs',     label: 'Ремонты',     children: <Repairs /> },
]

export default function Settings() {
  return (
    <>
      <Typography.Title level={3}>Справочники</Typography.Title>
      <Tabs items={items} />
    </>
  )
}
