const path = (parts) => [...new Set(parts.filter(Boolean).map((part) => String(part).trim()).filter(Boolean))].join(' / ') || '—'

export function equipmentLocation(item) {
  if (item.workplace) return path([item.placement || 'Рабочее место', item.workplace.name, item.workplace.location])
  return path([item.placement, item.branch?.name, item.department?.name])
}

export function deviceLocation(device) {
  return path([device.department?.branch?.name, device.department?.name, device.location])
}
