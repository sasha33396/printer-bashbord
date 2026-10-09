import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { existsSync } from 'node:fs'

// All API calls are intercepted in this isolated browser. Never writes to the backend.
// Start Vite/preview on port 4173 before running. Node 22+ and Chromium required.
const baseUrl = process.env.UI_SMOKE_URL || 'http://127.0.0.1:4173'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname), 'UI_SMOKE_URL must be a local server')
const chromePath = process.env.CHROME_BIN || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(existsSync)
assert.ok(chromePath, 'Set CHROME_BIN to a Chromium executable')

const root = path.resolve('.cache/redesign')
await mkdir(root, { recursive: true })
const chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${root}/chrome-profile`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
const endpoint = await new Promise((resolve, reject) => {
  let output = ''
  const timeout = setTimeout(() => reject(new Error('Chrome startup timeout')), 15000)
  chrome.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timeout); resolve(match[1]) } })
  chrome.on('error', reject)
})
const ws = new WebSocket(endpoint)
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject) })
let seq = 0
const pending = new Map(); const handlers = new Map(); const errors = []; const requests = []
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })) })
ws.addEventListener('message', async event => {
  const value = JSON.parse(event.data)
  if (value.id) { const promise = pending.get(value.id); pending.delete(value.id); value.error ? promise.reject(new Error(JSON.stringify(value.error))) : promise.resolve(value.result) }
  else for (const handler of handlers.get(value.method) || []) { try { await handler(value.params) } catch (error) { errors.push(error.message) } }
})
const on = (event, fn) => handlers.set(event, [...(handlers.get(event) || []), fn])
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const cmd = (method, params = {}) => send(method, params, sessionId)
const run = async expression => { const result = await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ' ' + result.exceptionDetails.exception?.description); return result.result.value }
const wait = async expression => { const deadline = Date.now() + 15000; while (Date.now() < deadline) { if (await run(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)) } await shot('failure'); console.log('Diagnostics', {errors, requests, body: await run('document.body.innerText'), url: await run('location.href')}); throw new Error('Timeout waiting for ' + expression) }
const branch = { id: 1, name: 'Москва (ЦАО)' }
const department = { id: 1, branch_id: 1, name: 'IT-отдел', branch }
const employee = { id: 1, full_name: 'Иванов Иван Иванович', position: 'Системный администратор', ad_login: 'ivanov', email: 'ivanov@example.test', phone: '+7 (000) 123-45-67', branch_id: 1, department_id: 1, branch, department, is_active: true }
const devices = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, inventory_number: `1-${String(i + 1).padStart(5, '0')}`, manufacturer: 'Kyocera', model: `ECOSYS Test ${i + 1}`, serial_number: `SN${i + 1}`, device_type: 'printer', status: i === 1 ? 'repair' : 'active', ip_address: `192.0.2.${i + 1}`, mac_address: '00:1A:4B:8F:2C:11', department_id: 1, department, location: 'Каб. 305', page_counter: 1248, purchase_date: '2026-01-10', warranty_until: '2027-01-10' }))
const item = { id: 1, inventory_number: '1-00100', name: 'Lenovo ThinkCentre', sku: 'ПК Lenovo', category: 'Компьютеры', tracking_type: 'asset', current_quantity: 1, min_quantity: 0, unit: 'шт.', condition: 'На складе', serial_number: 'PCSN1', branch_id: 1, department_id: 1, branch, department, processor: 'Intel Core i5', ram_gb: 16, storage_type: 'SSD', storage_capacity_gb: 512, notes: '', is_archived: false }
const workplace = { id: 1, name: 'RM-001', status: 'occupied', branch_id: 1, department_id: 1, branch, department, employee_id: 1, employee, location: 'Каб. 305', current_assets: [], assignment_history: [], has_photo: false }
const repair = { id: 1, device_id: 2, device: devices[1], date: '2026-10-01', repair_type: 'unplanned', repair_status: 'in_progress', description: 'Замятие бумаги', contractor: 'Сервис', responsible_person: 'Иванов И.И.', cost: 1500, work_items: [{ id: 1, description: 'Замена ролика', cost: 1500 }], invoice_name: null }
const signature = { id: 1, company_name: 'Тестовая компания', full_name: employee.full_name, inn: '0012345678', snils: '001-123-456 00', certificate_type: 'ФНС', valid_from: '2026-01-01', valid_to: '2026-10-20', term_status: 'expiring', days_left: 11, is_archived: false, created_at: '2026-01-01', updated_at: '2026-10-01' }
const power = { id: 1, power_number: '00001', grantor_name: 'Тестовая компания', representative_full_name: employee.full_name, valid_from: '2026-01-01', valid_to: '2026-10-20', term_status: 'expiring', days_left: 11, is_archived: false, created_at: '2026-01-01', updated_at: '2026-10-01' }
const history = { total: 1, items: [{ id: 1, occurred_at: '2026-10-01T12:00:00', category: 'device', event_type: 'created', entity_type: 'device', entity_id: 1, title: 'Добавлено устройство', entity_name: 'Kyocera ECOSYS Test 1', actor: 'admin', inventory_number: '1-00001', changes: {} }] }
let mode = 'populated'
on('Fetch.requestPaused', async ({ requestId, request }) => {
  const url = new URL(request.url); const p = url.pathname.slice(4)
  requests.push({ path: p, method: request.method, body: request.postData })
  let data
  if (p === '/devices') data = devices.filter(row => (!url.searchParams.get('status') || row.status === url.searchParams.get('status')))
  else if (/^\/devices\/\d+$/.test(p)) data = devices.find(row => row.id === Number(p.split('/').at(-1)))
  else if (p.endsWith('/photos') || p === '/consumables' || p.endsWith('/assignments') || p.endsWith('/movements')) data = []
  else if (p === '/warehouse/items') data = url.searchParams.get('archived') === 'true' ? [] : [item]
  else if (p === '/warehouse/items/1') data = item
  else if (p === '/workplaces') data = [workplace]
  else if (p === '/workplaces/1') data = workplace
  else if (p === '/repairs') data = [repair]
  else if (p === '/orgs/branches') data = [branch]
  else if (p === '/orgs/departments') data = [department]
  else if (p === '/manufacturers') data = [{ id: 1, name: 'Kyocera' }]
  else if (p === '/employees') data = [employee]
  else if (p === '/digital-documents/signatures') data = [signature]
  else if (p === '/digital-documents/signatures/1') data = signature
  else if (p === '/digital-documents/powers-of-attorney') data = [power]
  else if (p === '/digital-documents/powers-of-attorney/1') data = power
  else if (p === '/history') data = history
  else if (p === '/analytics/summary') data = { total_devices_active: 29, total_cost_period: 1500, repairs_by_type: { planned: 0, unplanned: 1, warranty: 0 }, top5_expensive: [] }
  else if (p === '/analytics/costs') data = [{ device_id: 2, inventory_number: '1-00002', model: devices[1].model, branch: branch.name, department: department.name, total_cost: 1500, total_repair_cost: 1500, repair_count: 1, total_consumable_cost: 0, consumable_count: 0 }]
  else if (request.method !== 'GET') data = { ...signature, ...JSON.parse(request.postData || '{}') }
  else { errors.push('Unexpected API ' + p); data = [] }
  if (mode === 'empty') { if (Array.isArray(data)) data = []; if (p === '/history') data = { items: [], total: 0 }; if (p === '/analytics/summary') data = { total_devices_active: 0, repairs_by_type: { planned: 0, unplanned: 0, warranty: 0 }, top5_expensive: [] } }
  await cmd('Fetch.fulfillRequest', { requestId, responseCode: mode === 'error' ? 503 : 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(mode === 'error' ? { detail: 'Сервис временно недоступен' } : data)).toString('base64') })
})
on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text))
await cmd('Runtime.enable'); await cmd('Page.enable'); await cmd('Fetch.enable', { patterns: [{ urlPattern: `${baseUrl}/api/*` }] })
await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('token', 'test.' + btoa(JSON.stringify({sub:'test-admin'})) + '.test')` })
const viewport = (width, height) => cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
const visit = async (route, text) => { await cmd('Page.navigate', { url: `${baseUrl}${route}` }); await wait(`document.body?.innerText.includes(${JSON.stringify(text)}) && !document.querySelector('.ant-spin-spinning')`); await new Promise(resolve => setTimeout(resolve, 250)); assert.equal(errors.length, 0, errors.join('\n')) }
const shot = async name => { const { data } = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(path.join(root, `${name}.png`), Buffer.from(data, 'base64')) }
const clickText = text => run(`Array.from(document.querySelectorAll('button')).find(button => button.innerText.trim() === ${JSON.stringify(text)})?.click()`)
try {
  await viewport(1440, 900)
  const routes = [['/', 'Панель управления'], ['/devices', 'Принтеры'], ['/warehouse', 'Склад'], ['/warehouse/archive', 'Архив'], ['/workplaces', 'Рабочие места'], ['/repairs', 'Ремонты'], ['/analytics', 'Аналитика'], ['/digital-documents/ecp', 'ЭЦП'], ['/digital-documents/mchd', 'МЧД'], ['/history', 'История движений'], ['/settings', 'Настройки'], ['/devices/1', 'ECOSYS Test 1'], ['/warehouse/items/1', 'Lenovo'], ['/workplaces/1', 'RM-001'], ['/digital-documents/ecp/1', 'Тестовая компания'], ['/digital-documents/mchd/1', '00001'], ['/login', 'Войти']]
  for (const [route, text] of routes) { await visit(route, text); await shot(route.replaceAll('/', '-') || 'overview'); console.log('PASS route', route) }
  for (const [route, record, text] of [['/devices','/devices/1','ECOSYS Test 1'], ['/warehouse','/warehouse/items/1','Lenovo'], ['/workplaces','/workplaces/1','RM-001'], ['/digital-documents/ecp','/digital-documents/ecp/1','0012345678'], ['/digital-documents/mchd','/digital-documents/mchd/1','00001']]) {
    await visit(`${route}?record=${encodeURIComponent(record)}`, text)
    assert.equal(await run('!!document.querySelector(".record-panel")'), true)
    await shot(`panel-${record.replaceAll('/', '-')}`)
    await run(`document.querySelector('button[aria-label="Закрыть карточку"]').click()`)
    await wait('!document.querySelector(".record-panel")'); console.log('PASS panel', record)
  }
  await visit('/devices', 'Принтеры')
  await run('document.querySelector(".ant-pagination-item-2 a").click()')
  await wait('document.querySelectorAll(".ant-table-row").length === 5')
  await run(`(() => { const input = document.querySelector('input[aria-label="Поиск принтеров"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'ECOSYS Test 30'); input.dispatchEvent(new Event('input', {bubbles:true})); })()`)
  await wait('document.querySelectorAll(".ant-table-row").length === 1')
  await run('document.querySelector(".ant-table-row").click()')
  await wait('!!document.querySelector(".record-panel")')
  assert.equal(await run(`document.querySelector('input[aria-label="Поиск принтеров"]').value`), 'ECOSYS Test 30')
  await run(`document.querySelector('button[aria-label="Закрыть карточку"]').click()`)
  await clickText('Сбросить')
  await wait('document.querySelectorAll(".ant-table-row").length > 1')
  console.log('PASS pagination and search retention across panel open/close')
  await clickText('Добавить устройство'); await wait('!!document.querySelector(".ant-modal")'); assert.ok(await run('document.querySelector(".ant-modal").innerText.includes("Инв.")')); await clickText('Отмена')
  await visit('/digital-documents/ecp?record=%2Fdigital-documents%2Fecp%2F1', '0012345678')
  await clickText('Редактировать'); await wait('!!document.querySelector(".ant-modal")')
  assert.equal(await run(`document.querySelector('input[id$="inn"]').value`), '0012345678')
  await clickText('Сохранить'); await wait('!document.querySelector(".ant-modal-wrap")'); assert.ok(requests.some(request => request.method === 'PUT' && request.path === '/digital-documents/signatures/1'))
  await visit('/repairs', 'Ремонты'); await run(`document.querySelector('button[aria-label="Редактировать ремонт"]').click()`); await wait('!!document.querySelector(".ant-modal")'); assert.ok(await run('document.querySelector(".ant-modal").innerText.includes("Проведённые работы")')); await clickText('Отмена')
  await visit('/settings', 'Настройки'); await run('document.querySelector(".ant-table-row").click()'); await wait('!!document.querySelector(".repair-detail")'); assert.ok(await run('document.querySelector(".repair-detail").innerText.includes("ivanov@example.test")'))
  console.log('PASS create/edit forms, identifier preservation, repair editor, employee panel')
  for (const [width, height] of [[1920,1080],[1366,768],[768,1024],[390,844]]) {
    await viewport(width,height); await visit('/devices?record=%2Fdevices%2F1', 'ECOSYS Test 1')
    assert.ok(await run('document.documentElement.scrollWidth <= innerWidth + 1'), `overflow at ${width}`)
    assert.equal(await run('!!document.querySelector(".record-panel")'), width >= 1200)
    if (width < 1200) assert.ok(await run('!!document.querySelector(".ant-drawer-open")'))
    await shot(`responsive-${width}`); console.log('PASS viewport', width, height)
  }
  await viewport(1440,900); mode = 'empty'; await visit('/', 'Панель управления'); assert.ok(await run('document.body?.innerText.includes("Нет данных")')); await shot('empty')
  mode = 'error'; await visit('/', 'Не удалось загрузить'); assert.ok(await run('document.body?.innerText.includes("принтеры")')); await shot('error')
  for (const route of ['/devices', '/warehouse', '/workplaces', '/digital-documents/ecp']) {
    await visit(route, 'Не удалось загрузить данные')
    assert.ok(await run('document.querySelector(".page-alert").innerText.includes("Повторить")'))
  }
  assert.equal(errors.length, 0, errors.join('\n')); console.log('PASS empty/error states; no runtime errors; all intercepted API requests stay within test fixtures')
} finally { await cmd('Browser.close').catch(() => {}); ws.close(); chrome.kill() }
