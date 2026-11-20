/** What identifies a delivery, worked out before anything scans the body. Stripe's event id is in its signed body
 *  (never a header); other senders' delivery-id headers are not signed. For every signed scheme a hash of the signed
 *  body also drops a replay under a new id, or one with no id at all. Unsigned webhooks dedupe by header only: anyone with the address could send a
 *  new body anyway, and identical alerts from such senders are legitimate. */
import { createHash } from 'node:crypto'
import type { Signing } from './webhook-signature'

const DELIVERY_HEADERS = ['x-github-delivery', 'webhook-id', 'x-delivery-id', 'x-event-id', 'idempotency-key']
const valid = (id: unknown) => (typeof id === 'string' && /^[\x21-\x7e]{1,200}$/.test(id) ? id : null)

function stripeEventId(raw: Uint8Array): string | null {
  try {
    return valid((JSON.parse(new TextDecoder().decode(raw)) as { id?: unknown } | null)?.id)
  } catch {
    return null
  }
}

export function deliveryKeys(signing: Signing | null, raw: Uint8Array, headers: Headers) {
  return {
    deliveryId: signing?.scheme === 'stripe' ? stripeEventId(raw) : valid(DELIVERY_HEADERS.map(name => headers.get(name)).find(Boolean)),
    bodyHash: signing ? createHash('sha256').update(raw).digest('hex') : null
  }
}
