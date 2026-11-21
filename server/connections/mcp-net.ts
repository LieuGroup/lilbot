/** SSRF protection for outside MCP services and their OAuth endpoints: refuses private, loopback, link-local, CGNAT,
 *  ULA, unspecified, multicast, reserved and IPv4-mapped IPv6 addresses, both as literal URLs and after DNS resolution.
 *  Explicit `127.0.0.1` / `localhost` / `[::1]` stays allowed only when the caller allows loopback (local dev services). */
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'

type LookupFn = (hostname: string, options: { all: true }) => Promise<{ address: string; family: number }[]>

let lookupImpl: LookupFn = (hostname, options) => dnsLookup(hostname, options)

/** Test hook to inject a deterministic DNS lookup without external network calls. */
export function setDnsLookup(fn?: LookupFn) {
  lookupImpl = fn ?? ((hostname, options) => dnsLookup(hostname, options))
}

const stripBrackets = (host: string) => (host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host)

export const isLoopbackHost = (hostname: string) => {
  const host = hostname.toLowerCase()
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1'
}

function blockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b, c] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64.0.0/10
  if (a === 169 && b === 254) return true // link-local / cloud metadata 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true // RFC 1918 172.16.0.0/12
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true // IETF / TEST-NET-1
  if (a === 192 && b === 168) return true // RFC 1918 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking 198.18.0.0/15
  if (a === 198 && b === 51 && c === 100) return true // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true // TEST-NET-3
  if (a >= 224) return true // multicast (224/4) & reserved/broadcast (240/4)
  return false
}

function parseIpv6(raw: string): number[] | null {
  if (raw.includes('%')) return null
  let text = raw.toLowerCase()
  const lastColon = text.lastIndexOf(':')
  if (lastColon >= 0 && text.slice(lastColon + 1).includes('.')) {
    const v4 = text
      .slice(lastColon + 1)
      .split('.')
      .map(Number)
    if (v4.length !== 4 || v4.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null
    text = `${text.slice(0, lastColon)}:${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  if (halves.length === 1 && left.length !== 8) return null
  const missing = 8 - left.length - right.length
  if (missing < 0) return null
  const words = [...left, ...Array(missing).fill('0'), ...right]
  if (words.length !== 8 || words.some(w => !/^[0-9a-f]{1,4}$/.test(w))) return null
  return words.map(w => Number.parseInt(w, 16))
}

function blockedIpv6(ip: string): boolean {
  const g = parseIpv6(ip)
  if (!g) return true
  if (g.every(w => w === 0)) return true // :: unspecified
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) return true // ::1 loopback & ::/96 IPv4-compatible
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) return true // ::ffff:0:0/96 IPv4-mapped
  if (g[0] === 0x0064 && g[1] === 0xff9b && (g[2] === 0 || g[2] === 1)) return true // NAT64
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true // discard 100::/64
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0x0db8)) return true // Teredo & documentation
  if (g[0] === 0x2002) return true // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true // ULA fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true // link-local & site-local
  if ((g[0] & 0xff00) === 0xff00) return true // multicast ff00::/8
  return false
}

/** Whether `ip` (bare IPv4 or IPv6, with or without brackets) is non-public and must be refused for remote requests. */
export function isBlockedIp(raw: string): boolean {
  const ip = stripBrackets(raw.trim())
  const kind = isIP(ip)
  if (kind === 4) return blockedIpv4(ip)
  if (kind === 6) return blockedIpv6(ip)
  return true
}

/** Checks that a literal IP URL is public (or explicitly loopback when allowed). */
export function isBlockedLiteralHost(hostname: string, allowLoopback = false): boolean {
  if (allowLoopback && isLoopbackHost(hostname)) return false
  const bare = stripBrackets(hostname.trim())
  return isIP(bare) !== 0 && isBlockedIp(bare)
}

/** Resolves `url.hostname` and refuses any private, loopback, link-local, CGNAT, ULA, multicast or reserved address. */
export async function assertPublicAddress(url: URL, allowLoopback = false): Promise<void> {
  if (allowLoopback && isLoopbackHost(url.hostname)) return
  const bare = stripBrackets(url.hostname.trim())
  if (isIP(bare) !== 0) {
    if (isBlockedIp(bare)) throw new Error('blocked address')
    return
  }
  const records = await lookupImpl(bare, { all: true })
  if (!records.length || records.some(entry => isBlockedIp(entry.address))) throw new Error('blocked address')
}
