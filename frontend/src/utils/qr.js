import QRCode from 'qrcode'

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')

export async function printQrLabel({ path, inventoryNumber, title, subtitle }) {
  const printWindow = window.open('', '_blank', 'width=520,height=680')
  if (!printWindow) throw new Error('Браузер заблокировал окно печати')

  const url = new URL(path, window.location.origin).toString()
  try {
    const qr = await QRCode.toDataURL(url, { width: 360, margin: 1, errorCorrectionLevel: 'M' })
    printWindow.document.write(`<!doctype html>
      <html lang="ru"><head><meta charset="utf-8"><title>Инвентарная этикетка</title>
      <style>
        @page { size: 50mm 40mm; margin: 2mm; }
        * { box-sizing: border-box; }
        body { margin: 0; font: 10px Arial, sans-serif; color: #000; }
        .label { width: 46mm; height: 36mm; display: grid; grid-template-columns: 25mm 1fr; gap: 2mm; align-items: center; }
        img { width: 25mm; height: 25mm; }
        .inventory { font-size: 13px; font-weight: 700; margin: 3px 0; word-break: break-word; }
        .title { font-weight: 700; }
        .subtitle { margin-top: 3px; }
        .url { margin-top: 4px; font-size: 7px; overflow-wrap: anywhere; }
        @media screen { body { padding: 16px; } .label { border: 1px dashed #aaa; } }
      </style></head><body><div class="label">
        <img src="${qr}" alt="QR">
        <div><div class="title">${escapeHtml(title)}</div>
        <div class="inventory">Инв. № ${escapeHtml(inventoryNumber || '—')}</div>
        <div class="subtitle">${escapeHtml(subtitle || '')}</div>
        <div class="url">${escapeHtml(url)}</div></div>
      </div><script>window.onload=()=>window.print()</script></body></html>`)
    printWindow.document.close()
  } catch (error) {
    printWindow.close()
    throw error
  }
}

export function qrTargetPath(value) {
  try {
    const url = new URL(value, window.location.origin)
    const match = url.pathname.match(/^\/(devices\/\d+|warehouse\/items\/\d+)\/?$/)
    return match ? `/${match[1]}` : null
  } catch {
    return null
  }
}
