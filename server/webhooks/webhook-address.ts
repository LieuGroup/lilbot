/** A webhook's address is its secret: `/hook/` and 64 base64url characters, the webhook id (16 bytes) and a MAC of it
 *  and a random per-webhook nonce (32 bytes) under the engine token. The address is never stored: it is computed when
 *  shown. A new nonce replaces it, so even someone holding the engine token cannot work out the next one, and deleting
 *  the webhook ends it. Comparisons are timing-safe. */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { connectionKey } from '../connections/connection-keys'

export const HOOK_PATH = /^\/hook\/([A-Za-z0-9_-]{64})$/
const NO_WEBHOOK = { id: '00000000-0000-0000-0000-000000000000', nonce: '' }

export const newAddressNonce = () => randomBytes(32).toString('hex')

const expected = (key: string, webhook: { id: string; nonce: string }) =>
  Buffer.concat([Buffer.from(webhook.id.replaceAll('-', ''), 'hex'), Buffer.from(connectionKey(key, 'webhook-address', `${webhook.id}:${webhook.nonce}`), 'hex')])

export const addressPath = (key: string, webhook: { id: string; nonce: string }) => `/hook/${expected(key, webhook).toString('base64url')}`

/** The webhook id an address claims. Not proof: check it with `addressMatches`. */
export function claimedId(token: string): string {
  const hex = Buffer.from(token, 'base64url').subarray(0, 16).toString('hex').padEnd(32, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Computes one MAC whether or not the webhook exists, so timing does not tell which ids do. */
export function addressMatches(key: string, token: string, webhook: { id: string; nonce: string } | null): boolean {
  const given = Buffer.from(token, 'base64url')
  const want = expected(key, webhook ?? NO_WEBHOOK)
  return !!webhook && given.length === want.length && timingSafeEqual(given, want)
}
