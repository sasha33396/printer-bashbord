export function deviceWebUrl(address) {
  if (!address) return null
  return address.includes(':') ? `http://[${address}]/` : `http://${address}/`
}

export async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // Local HTTP pages may expose the API but reject clipboard access.
    }
  }

  const input = document.createElement('textarea')
  input.value = value
  input.setAttribute('readonly', '')
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.appendChild(input)
  input.select()
  input.setSelectionRange(0, input.value.length)
  try {
    if (!document.execCommand('copy')) throw new Error('Copy command failed')
  } finally {
    input.remove()
  }
}
