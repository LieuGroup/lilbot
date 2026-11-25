/** ES256 provider JWT minting and 45-minute caching for direct Apple APNs authentication. */
import { createPrivateKey, type KeyObject, sign } from 'node:crypto'

export const APNS_TOKEN_TTL_MS = 45 * 60_000
const APPLE_ID = /^[A-Za-z0-9]{10}$/

export interface ApnsCredentials {
  keyId: string
  teamId: string
  privateKeyPem: string
}

export class ApnsTokenProvider {
  private readonly key: KeyObject
  private readonly keyId: string
  private readonly teamId: string
  private readonly ttlMs: number
  private cached: { jwt: string; issuedAtMs: number } | null = null

  constructor(credentials: ApnsCredentials, ttlMs = APNS_TOKEN_TTL_MS) {
    const keyId = credentials.keyId.trim()
    const teamId = credentials.teamId.trim()
    if (!APPLE_ID.test(keyId)) throw new Error('Invalid APNs key id format')
    if (!APPLE_ID.test(teamId)) throw new Error('Invalid APNs team id format')
    const key = createPrivateKey(credentials.privateKeyPem)
    if (key.type !== 'private' || key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      throw new Error('APNs signing key must be an EC prime256v1 private key')
    }
    this.key = key
    this.keyId = keyId
    this.teamId = teamId
    this.ttlMs = ttlMs
  }

  /** Returns a cached ES256 JWT or mints a fresh one when the cache is empty or older than `ttlMs`. */
  getToken(nowMs: number): string {
    if (this.cached && nowMs - this.cached.issuedAtMs < this.ttlMs && nowMs >= this.cached.issuedAtMs) {
      return this.cached.jwt
    }
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: this.keyId })).toString('base64url')
    const claims = Buffer.from(JSON.stringify({ iss: this.teamId, iat: Math.floor(nowMs / 1000) })).toString('base64url')
    const signingInput = `${header}.${claims}`
    const signature = sign('sha256', Buffer.from(signingInput), { key: this.key, dsaEncoding: 'ieee-p1363' }).toString('base64url')
    const jwt = `${signingInput}.${signature}`
    this.cached = { jwt, issuedAtMs: nowMs }
    return jwt
  }

  /** Clears the cached JWT (if it still matches `expectedJwt` when supplied) so concurrent expiries mint only one new token. */
  invalidate(expectedJwt?: string) {
    if (!expectedJwt || this.cached?.jwt === expectedJwt) this.cached = null
  }
}
