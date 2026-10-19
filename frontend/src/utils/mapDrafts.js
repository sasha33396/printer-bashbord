// IndexedDB keeps image blobs with the draft, without localStorage's small quota.
const openDatabase = () => new Promise((resolve, reject) => {
  const request = indexedDB.open('printer-map-drafts', 1)
  request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'key' })
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})
const draftKey = (floorId) => {
  let username = ''
  try { username = JSON.parse(atob(localStorage.getItem('token').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub || '' } catch { /* unauthenticated drafts stay separate */ }
  return `${username}:${floorId}`
}
async function transaction(floorId, mode, action) {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = database.transaction('drafts', mode)
    const request = action(tx.objectStore('drafts'), draftKey(floorId))
    tx.oncomplete = () => { database.close(); resolve(request.result) }
    tx.onerror = tx.onabort = () => { database.close(); reject(tx.error || request.error || new Error('Не удалось сохранить черновик')) }
  })
}
export const readMapDraft = floorId => transaction(floorId, 'readonly', (store, key) => store.get(key))
export const writeMapDraft = (floorId, value) => transaction(floorId, 'readwrite', (store, key) => store.put({ ...value, key, saved_at: new Date().toISOString() }))
export const deleteMapDraft = floorId => transaction(floorId, 'readwrite', (store, key) => store.delete(key))
