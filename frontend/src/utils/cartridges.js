export const CARTRIDGE_STATES = {
  ready: 'Запасной', installed: 'Установлен', empty: 'Пустой',
  refilling: 'На заправке', defective: 'Неисправен', written_off: 'Списан',
}
export const CARTRIDGE_OPERATIONS = {
  received: 'Поступление', registered: 'Перевод в поштучный учёт', transfer: 'Передача',
  install: 'Установка / замена', remove: 'Снятие', send_refill: 'Отправка на заправку',
  return_refill: 'Возврат с заправки', defective: 'Неисправность', write_off: 'Списание',
  refill_deadline: 'Срок возврата',
  deleted: 'Удаление карточки',
}
export const STATE_COLORS = {
  ready: 'green', installed: 'blue', empty: 'orange', refilling: 'purple', defective: 'red', written_off: 'default',
}
export function cartridgeSummary(items, grouping = 'holder') {
  const groups = new Map()
  for (const item of items) {
    if (item.state === 'written_off') continue
    const byDepartment = grouping === 'department'
    const key = JSON.stringify(byDepartment
      ? [item.branch_id, item.department_id, item.name]
      : [item.holder_type, item.branch_id, item.department_id, item.employee_id, item.contractor, item.name])
    if (!groups.has(key)) groups.set(key, {
      key, name: item.name,
      location: byDepartment ? [item.branch_name, item.department_name || 'Без отдела'].filter(Boolean).join(' / ')
        : item.holder_type === 'contractor' ? `Заправка: ${item.contractor}` : [
        item.branch_name, item.department_name,
        item.holder_type === 'employee' ? item.employee_name : item.holder_type === 'warehouse' ? 'Склад' : null,
      ].filter(Boolean).join(' / '),
      ready: 0, installed: 0, empty: 0, refilling: 0, defective: 0, total: 0,
    })
    const group = groups.get(key)
    if (Object.hasOwn(group, item.state)) group[item.state] += 1
    group.total += 1
  }
  return [...groups.values()]
}

export function actionAllowed(operation, item) {
  if (item.state === 'written_off') return false
  if (operation === 'install') return item.state === 'ready'
  if (operation === 'remove') return item.state === 'installed'
  if (operation === 'send_refill') return item.state === 'empty'
  if (operation === 'return_refill') return item.state === 'refilling'
  if (operation === 'refill_deadline') return item.state === 'refilling'
  return ['ready', 'empty', 'defective'].includes(item.state)
}

export const normalizedModel = (value = '') => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru')

export function cartridgeCompatibility(item, device) {
  if (!device || !item.compatible_models?.length) return 'unknown'
  return item.compatible_models.some((model) => normalizedModel(model.manufacturer) === normalizedModel(device.manufacturer)
    && normalizedModel(model.model) === normalizedModel(device.model)) ? 'compatible' : 'incompatible'
}

export function installationCandidates(items, device, includeUnknown = true) {
  if (!device) return []
  return items.filter((item) => item.state === 'ready' && (cartridgeCompatibility(item, device) === 'compatible'
    || (includeUnknown && cartridgeCompatibility(item, device) === 'unknown')))
}

export function cartridgeMatchesAttention(item, attention, installedDays = 30) {
  if (attention === 'overdue') return item.state === 'refilling' && item.refill_overdue === true
  if (attention === 'no_deadline') return item.state === 'refilling' && !item.expected_return_date
  if (attention === 'empty') return item.state === 'empty'
  if (attention === 'installed_long') return item.state === 'installed' && item.state_days != null && item.state_days > installedDays
  return true
}

export function cartridgeCycles(operations) {
  const installed = new Map(), cycles = []
  const ordered = [...operations].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  for (const event of ordered) {
    if (event.operation === 'install') installed.set(event.item_id, event)
    if (event.operation !== 'remove') continue
    const start = installed.get(event.item_id)
    const matching = start && start.device_id === event.device_id && start.slot === event.slot
    cycles.push({ ...event, installed_at: matching ? start.date : null,
      initial_counter: matching ? start.page_counter : null })
    installed.delete(event.item_id)
  }
  return cycles.reverse()
}
