import JsBarcode from 'jsbarcode'

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')

const PATH_TYPES = [
  { pattern: /^\/devices\/(\d+)\/?$/, prefix: 'D' },
  { pattern: /^\/warehouse\/items\/(\d+)\/?$/, prefix: 'I' },
  { pattern: /^\/workplaces\/(\d+)\/?$/, prefix: 'W' },
]

const TARGET_PATHS = {
  D: (id) => `/devices/${id}`,
  I: (id) => `/warehouse/items/${id}`,
  W: (id) => `/workplaces/${id}`,
}

export function barcodeValue(path) {
  const pathname = String(path || '').split(/[?#]/, 1)[0]
  for (const type of PATH_TYPES) {
    const match = pathname.match(type.pattern)
    if (match) return `PD-${type.prefix}-${match[1]}`
  }
  throw new Error('Для этой страницы нельзя сформировать штрихкод')
}

export function barcodeTargetPath(value) {
  const match = String(value || '').trim().toUpperCase().match(/^PD-([DIW])-(\d+)$/)
  if (!match || match[2] === '0') return null
  return TARGET_PATHS[match[1]](match[2])
}

export async function printBarcodeLabel({ path, inventoryNumber, title, subtitle }) {
  const printWindow = window.open('', '_blank', 'width=680,height=520')
  if (!printWindow) throw new Error('Браузер заблокировал окно печати')

  try {
    const value = barcodeValue(path)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    JsBarcode(svg, value, {
      format: 'CODE128',
      width: 2,
      height: 64,
      margin: 0,
      displayValue: false,
      background: '#ffffff',
      lineColor: '#000000',
    })
    const barcode = new XMLSerializer().serializeToString(svg)

    printWindow.document.write(`<!doctype html>
      <html lang="ru"><head><meta charset="utf-8"><title>Инвентарная этикетка</title>
      <style>
        @page { size: 50mm 40mm; margin: 2mm; }
        * { box-sizing: border-box; }
        body { margin: 0; font: 9px Arial, sans-serif; color: #000; }
        .label { width: 46mm; height: 36mm; display: flex; flex-direction: column; justify-content: center; overflow: hidden; }
        .title { font-size: 10px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .barcode { display: flex; width: 100%; height: 18mm; align-items: center; justify-content: center; margin: 1mm 0 0.5mm; }
        .barcode svg { width: 100%; height: 18mm; }
        .code { font: 700 8px monospace; text-align: center; letter-spacing: 0.8px; }
        .inventory { margin-top: 1mm; font-size: 12px; font-weight: 700; text-align: center; overflow-wrap: anywhere; }
        .subtitle { margin-top: 0.5mm; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        @media screen { body { padding: 16px; } .label { border: 1px dashed #aaa; } }
      </style></head><body><div class="label">
        <div class="title">${escapeHtml(title)}</div>
        <div class="barcode">${barcode}</div>
        <div class="code">${escapeHtml(value)}</div>
        <div class="inventory">Инв. № ${escapeHtml(inventoryNumber || '—')}</div>
        <div class="subtitle">${escapeHtml(subtitle || '')}</div>
      </div><script>window.onload=()=>window.print()</script></body></html>`)
    printWindow.document.close()
  } catch (error) {
    printWindow.close()
    throw error
  }
}
