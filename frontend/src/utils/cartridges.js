export const CARTRIDGE_STATES = {
  ready: 'Запасной', installed: 'Установлен', empty: 'Пустой',
  refilling: 'На заправке', defective: 'Неисправен', written_off: 'Списан',
}
export const CARTRIDGE_OPERATIONS = {
  received: 'Поступление', registered: 'Перевод в поштучный учёт', transfer: 'Передача',
  install: 'Установка / замена', remove: 'Снятие', send_refill: 'Отправка на заправку',
  return_refill: 'Возврат с заправки', defective: 'Неисправность', write_off: 'Списание',
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
  return ['ready', 'empty', 'defective'].includes(item.state)
}
