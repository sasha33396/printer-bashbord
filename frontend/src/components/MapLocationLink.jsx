import { useEffect, useState } from 'react'
import { Button, Tooltip } from 'antd'
import { EnvironmentOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import api from '../api/api'

export default function MapLocationLink({ entityType, entityId }) {
  const navigate = useNavigate()
  const [location, setLocation] = useState(null)
  useEffect(() => {
    let active = true
    setLocation(null)
    api.get(`/maps/locate/${entityType}/${entityId}`).then(({ data }) => { if (active) setLocation(data) })
      .catch(() => { if (active) setLocation({ placed: false }) })
    return () => { active = false }
  }, [entityType, entityId])
  const position = location?.position
  return <Tooltip title={position ? `${position.building_name} · ${position.floor_name}${position.inherited ? ' · через рабочее место / принтер' : ''}` : 'Открыть план и выбрать место для объекта'}>
    <Button icon={<EnvironmentOutlined />} loading={!location} onClick={() => navigate(position?.path || `/maps?place=${entityType}:${entityId}`)}>
      {location?.placed ? 'На карте' : 'Разместить на карте'}
    </Button>
  </Tooltip>
}
