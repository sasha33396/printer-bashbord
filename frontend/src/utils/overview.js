export function groupCounts(rows, getLabel) {
  const counts = new Map()
  for (const row of rows) {
    const label = getLabel(row) || 'Не указан'
    counts.set(label, (counts.get(label) || 0) + 1)
  }
  return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
}

// Quantities of consumables are not individual IT assets.
export function inventoryAssets(devices, items) {
  return [...devices.map((row) => ({ ...row, category: 'Печатающая техника', branch: row.department?.branch })),
    ...items.filter((row) => row.tracking_type === 'asset' && !row.is_archived)]
}

export function expiringDocuments(signatures, powers) {
  return [...signatures.map((row) => ({ ...row, kind: 'ecp', owner: row.full_name })),
    ...powers.map((row) => ({ ...row, kind: 'mchd', owner: row.representative_full_name }))]
    .filter((row) => !row.is_archived && row.term_status === 'expiring')
    .sort((a, b) => String(a.valid_to).localeCompare(String(b.valid_to)))
}
