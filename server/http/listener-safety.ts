import { isIP } from 'node:net'
export const plainServerError = () => new Response('Internal server error', { status: 500, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain' } })
export function isTunnelRequest(request: Request) {
  return request.headers.has('cf-connecting-ip') || request.headers.has('cf-ray') || /(?:^|[\s,;])cloudflare(?:$|[\s,;])/i.test(request.headers.get('cdn-loop') ?? '')
}
export function checkPublicPort(port: number, privatePort: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === privatePort) throw new Error('Public door needs a separate valid port.')
}
/** Mapped IPv4 shares its /32; IPv6 shares a /48 to resist prefix rotation. */
export function addressGroup(address: string) {
  if (isIP(address) !== 6) return address
  const source = new URL(`http://[${address}]/`).hostname.slice(1, -1)
  const parts = source.split('::')
  const left = parts[0].split(':').filter(Boolean)
  const right = (parts[1] ?? '').split(':').filter(Boolean)
  const words = (parts.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left).map(word => Number.parseInt(word, 16))
  if (words.slice(0, 5).every(word => word === 0) && words[5] === 65535) return [words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].join('.')
  return `${words
    .slice(0, 3)
    .map(word => word.toString(16))
    .join(':')}::/48`
}
/** No eviction of live budgets: new groups fail closed when capacity is reached. */
export function connectionBudget(limit = 20, full = false) {
  const entries = new Map<string, { count: number; until: number }>()
  return (address: string, now = Date.now()) => {
    for (const [key, entry] of entries) {
      if (entry.until > now) break
      entries.delete(key)
    }
    address = addressGroup(address)
    let entry = entries.get(address)
    if (!entry) {
      if (entries.size >= 4096) return full
      entry = { count: 0, until: now + 60_000 }
      entries.set(address, entry)
    }
    return ++entry.count <= limit
  }
}
export function byteBudget(capacity = 52_000_000, perSecond = 2_000_000) {
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
