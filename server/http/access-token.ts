import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose'
import type { AccessSettings } from './access-settings'

/** One resolver per listener: coalesced fetches, ten-minute cache, 30-second refresh cooldown. */
export function accessVerifier(settings: AccessSettings) {
  let lastAttempt = -Infinity
  const keys = createRemoteJWKSet(settings.certsUrl, {
    cacheMaxAge: 600_000,
    cooldownDuration: 30_000,
    timeoutDuration: 5_000,
    [customFetch]: (url, options) => {
      // jose's cooldown covers successful fetches; failures must be rate-limited too.
      const now = Date.now()
      if (now - lastAttempt < 30_000) throw new Error('Access key refresh cooling down.')
      lastAttempt = now
      return fetch(url, options)
    }
  })
  return async (token: string | undefined): Promise<boolean> => {
    if (!token || token.length > 16_384) return false
    try {
      const { payload } = await jwtVerify(
        token,
        (header, input) => {
          if (typeof header.kid !== 'string' || !header.kid || header.kid.length > 256) throw new Error('Access key id required.')
          return keys(header, input)
        },
        {
          algorithms: ['RS256'],
          issuer: settings.issuer,
          audience: settings.audience,
          requiredClaims: ['exp', 'nbf', 'email'],
          clockTolerance: 30
        }
      )
      return typeof payload.email === 'string' && payload.email.toLowerCase() === settings.email
    } catch {
      return false
    }
  }
}

/** Cookies are accepted only for the browser socket; a present header always takes precedence. */
export function accessToken(request: Request): string | undefined {
  const header = request.headers.get('cf-access-jwt-assertion')
  if (header !== null) return header
  if (new URL(request.url).pathname !== '/ws' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return
  const cookies = (request.headers.get('cookie') ?? '').split(';').map(cookie => cookie.trim())
  const matches = cookies.filter(cookie => cookie.startsWith('CF_Authorization='))
  if (matches.length === 1) return matches[0].slice('CF_Authorization='.length)
}
