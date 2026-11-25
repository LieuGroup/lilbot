/** Pure server URL and same-origin auth header guards (zero React Native imports so unit tests
 *  verify cross-origin rejection and Access JWT scoping directly on Linux). */

/** "https://lilbot.example.com" or a bare host becomes the normalized HTTP origin for uploads and images. */
export function httpOrigin(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '')
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
}

/** "https://lilbot.example.com" or a bare host becomes the `/ws` address of that server. */
export function socketUrl(base: string): string {
  return `${httpOrigin(base).replace(/^http/, 'ws')}/ws`
}

function parseOrigin(url: string): { origin: string; protocol: string } | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return { origin: parsed.origin, protocol: parsed.protocol }
  } catch {
    return null
  }
}

/** Resolves a server-relative path (or same-origin absolute URL) against the configured server address.
 *  Returns `null` for any cross-origin URL, protocol-relative foreign host, or non-HTTP(S) scheme so
 *  untrusted addresses are never fetched as LilBot server assets. */
export function resolveServerAssetUrl(path: string, serverUrl: string | null | undefined): string | null {
  const raw = path.trim()
  if (!raw || !serverUrl?.trim()) return null
  const baseStr = httpOrigin(serverUrl)
  const base = parseOrigin(baseStr)
  if (!base) return null

  if (/^https?:\/\//i.test(raw) || raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    try {
      const parsed = new URL(raw, baseStr)
      if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.origin !== base.origin) return null
      return parsed.toString()
    } catch {
      return null
    }
  }

  const normalized = raw.startsWith('/') ? raw : `/${raw}`
  return `${baseStr}${normalized}`
}

/** Returns the Cloudflare Access JWT header ONLY when `targetUrl` matches the configured server's exact origin.
 *  Prevents leaking the Access JWT to any foreign or relative-unverified URL. */
export function authHeadersForUrl(
  targetUrl: string | null | undefined,
  serverUrl: string | null | undefined,
  accessToken: string | null | undefined
): Record<string, string> {
  const token = accessToken?.trim() ?? ''
  if (!token || !targetUrl || !serverUrl?.trim()) return {}
  const base = parseOrigin(httpOrigin(serverUrl))
  const target = parseOrigin(targetUrl)
  if (!base || !target || target.origin !== base.origin) return {}
  return { 'cf-access-jwt-assertion': token }
}
