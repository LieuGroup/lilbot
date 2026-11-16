export const plainServerError = () => new Response('Internal server error', { status: 500, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain' } })
export function isTunnelRequest(request: Request) {
  return request.headers.has('cf-connecting-ip') || request.headers.has('cf-ray') || /(?:^|[\s,;])cloudflare(?:$|[\s,;])/i.test(request.headers.get('cdn-loop') ?? '')
}
export function checkPublicPort(port: number, privatePort: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === privatePort) throw new Error('Public door needs a separate valid port.')
}
/** Bounded per-address budget, including failed registration/upgrade attempts. */
export function connectionBudget() {
  const entries = new Map<string, { count: number; until: number }>()
  return (address: string, now = Date.now()) => {
    for (const [key, entry] of entries) if (entry.until <= now) entries.delete(key)
    let entry = entries.get(address)
    if (!entry) {
      if (entries.size >= 4096) return false
      entry = { count: 0, until: now + 60_000 }
      entries.set(address, entry)
    }
    return ++entry.count <= 20
  }
}
