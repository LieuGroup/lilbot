import { isIP } from 'node:net'
export const plainServerError = () => new Response('Internal server error', { status: 500, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain' } })
export function isTunnelRequest(request: Request) {
  return request.headers.has('cf-connecting-ip') || request.headers.has('cf-ray') || /(?:^|[\s,;])cloudflare(?:$|[\s,;])/i.test(request.headers.get('cdn-loop') ?? '')
}
export function checkPublicPort(port: number, privatePort: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === privatePort) throw new Error('Public door needs a separate valid port.')
}
/** IPv6 addresses share a /64 budget, including compressed and IPv4-mapped forms. */
export function addressGroup(address: string) {
  if (isIP(address) !== 6) return address
  let source = new URL(`http://[${address}]/`).hostname.slice(1, -1)
  const parts = source.split('::')
  const left = parts[0].split(':').filter(Boolean)
  const right = (parts[1] ?? '').split(':').filter(Boolean)
  const words = parts.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left
  source = words
    .slice(0, 4)
    .map(word => Number.parseInt(word, 16).toString(16))
    .join(':')
  return `${source}::/64`
}
/** Bounded unauthenticated attempt budget. Verified helpers bypass it. */
export function connectionBudget() {
  const entries = new Map<string, { count: number; until: number }>()
  return (address: string, now = Date.now()) => {
    for (const [key, entry] of entries) {
      if (entry.until > now) break
      entries.delete(key)
    }
    address = addressGroup(address)
    let entry = entries.get(address)
    if (!entry) {
      if (entries.size >= 4096) entries.delete(entries.keys().next().value!)
      entry = { count: 0, until: now + 60_000 }
      entries.set(address, entry)
    }
    return ++entry.count <= 20
  }
}
/** Token bucket per authenticated socket, checked before JSON parsing. */
export function byteBudget(capacity = 16_200_000, perSecond = 1_000_000) {
  let remaining = capacity
  let last = Date.now()
  return (bytes: number, now = Date.now()) => {
    remaining = Math.min(capacity, remaining + (Math.max(0, now - last) * perSecond) / 1000)
    last = now
    if (bytes > remaining) return false
    remaining -= bytes
    return true
  }
}
