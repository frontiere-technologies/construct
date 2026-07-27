const FETCH_TIMEOUT_MS = 4000

function blocksEmbedding(headers: Headers): boolean {
  const xfo = headers.get('x-frame-options')?.trim().toUpperCase()
  if (xfo === 'DENY' || xfo === 'SAMEORIGIN') return true

  const csp = headers.get('content-security-policy')
  if (csp) {
    const directive = csp
      .split(';')
      .map(d => d.trim())
      .find(d => d.toLowerCase().startsWith('frame-ancestors'))
    if (directive) {
      const sources = directive.split(/\s+/).slice(1)
      const allowsAny = sources.some(s => s === '*')
      if (!allowsAny) return true
    }
  }
  return false
}

async function fetchWithTimeout(url: string, method: 'HEAD' | 'GET'): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { method, signal: controller.signal, redirect: 'follow' })
  } finally {
    clearTimeout(timer)
  }
}

export async function checkEmbeddable(url: string): Promise<boolean> {
  if (!/^https?:\/\//i.test(url)) return false
  try {
    let res = await fetchWithTimeout(url, 'HEAD')
    if (res.status === 405 || res.status === 501) {
      res = await fetchWithTimeout(url, 'GET')
    }
    return !blocksEmbedding(res.headers)
  } catch {
    return false
  }
}
