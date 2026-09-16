import { useParams } from 'react-router-dom'
import { Typography } from 'antd'

export default function DeviceCard() {
  const { id } = useParams()
  return <Typography.Title level={3}>Устройство #{id}</Typography.Title>
}
