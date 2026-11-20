/** Sender signatures, checked over the raw body bytes: GitHub's `X-Hub-Signature-256`, Stripe's `Stripe-Signature`
 *  (with its five-minute timestamp tolerance), or an HMAC-SHA256 of the body in a header the sender names. */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { WebhookSigning } from '../../shared/webhook-schema'

/** A webhook's stored signing settings: the secret is always set. */
export type Signing = WebhookSigning & { secret: string }

const STRIPE_TOLERANCE_SECONDS = 300

export const newSigningSecret = () => randomBytes(32).toString('hex')

const hmac = (secret: string, ...parts: (string | Uint8Array)[]) => {
  const mac = createHmac('sha256', secret)
  for (const part of parts) mac.update(part)
  return mac.digest()
}
const same = (given: Buffer, want: Buffer) => given.length === want.length && timingSafeEqual(given, want)

/** A SHA-256 digest written as hex or base64, with or without a `sha256=` prefix. */
function digest(value: string): Buffer | null {
  const text = value.trim().replace(/^sha256=/i, '')
  if (/^[0-9a-f]{64}$/i.test(text)) return Buffer.from(text, 'hex')
  if (/^[A-Za-z0-9+/]{43}=?$/.test(text)) return Buffer.from(text, 'base64')
  if (/^[A-Za-z0-9_-]{43}$/.test(text)) return Buffer.from(text, 'base64url')
  return null
}

export function signatureValid(signing: Signing, body: Uint8Array, headers: Headers, now: number): boolean {
  if (signing.scheme === 'github') {
    const value = headers.get('x-hub-signature-256') ?? ''
    const given = value.startsWith('sha256=') ? digest(value) : null
    return !!given && same(given, hmac(signing.secret, body))
  }
  if (signing.scheme === 'stripe') {
    const fields = (headers.get('stripe-signature') ?? '').split(',').map(field => [field.slice(0, field.indexOf('=')), field.slice(field.indexOf('=') + 1)])
    const time = fields.find(([key]) => key === 't')?.[1] ?? ''
    if (!/^\d{1,12}$/.test(time) || Math.abs(now / 1000 - Number(time)) > STRIPE_TOLERANCE_SECONDS) return false
    const want = hmac(signing.secret, `${time}.`, body)
    return fields.some(([key, value]) => key === 'v1' && /^[0-9a-f]{64}$/.test(value) && same(Buffer.from(value, 'hex'), want))
  }
  const given = digest(headers.get(signing.header) ?? '')
  return !!given && same(given, hmac(signing.secret, body))
}
