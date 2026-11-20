/** `POST /hook/<address>` on the helper door: the one public route that wakes a bot. It answers once the event is
 *  stored; the run happens later. Unknown, deleted or malformed addresses, other methods and a deleted bot's webhooks
 *  all get the door's own 404 (null here). Nothing about a request is logged except refused signatures, by webhook id,
 *  at most once a minute each. */
import { WEBHOOK_LIMITS } from '../webhooks/webhook-limits'
import type { WebhookService } from '../webhooks/webhook-service'
import { connectionBudget, readLimited } from './listener-safety'

export type HookAnswer = [status: number, text: string] | null

export function webhookRoute(webhooks: WebhookService) {
  // A full address table lets new senders through: the per-webhook budget and the run limits still hold.
  const perAddress = connectionBudget(WEBHOOK_LIMITS.perAddressPerMinute, true)
  const perWebhook = connectionBudget(WEBHOOK_LIMITS.perWebhookPerMinute)
  // One line per webhook a minute at most, with how many more were refused: the log cannot be flooded.
  const refused = new Map<string, { at: number; more: number }>()
  const logRefusal = (id: string, now = Date.now()) => {
    const last = refused.get(id)
    if (last && now - last.at < 60_000) return void last.more++
    const more = last?.more ? ` (and ${last.more} more in the minute before)` : ''
    console.warn(`[webhooks] refused an unsigned or wrongly signed delivery for webhook ${id}${more}`)
    refused.set(id, { at: now, more: 0 })
  }
  // Preparing an event is synchronous (tens of milliseconds for the worst body): deliveries arriving together are
  // prepared one at a time, each in its own turn of the event loop, so a burst never holds the server for its sum.
  let line: Promise<unknown> = Promise.resolve()
  const inTurn = <T>(work: () => T): Promise<T> => {
    const next = line.then(() => new Promise(resolve => setTimeout(resolve, 0))).then(work)
    line = next.catch(() => {})
    return next
  }
  return async (request: Request, token: string, address: string): Promise<HookAnswer> => {
    if (!perAddress(address)) return [429, 'Too many requests']
    const hook = request.method === 'POST' ? webhooks.find(token) : null
    if (!hook) return null
    if (hook.paused) return [409, 'Webhook paused']
    const body = await readLimited(request, WEBHOOK_LIMITS.bodyBytes)
    if (!body) return [413, 'Payload too large']
    if (!webhooks.verify(hook, body, request.headers)) {
      logRefusal(hook.id)
      return [401, 'Signature refused']
    }
    // Spent only once the sender proved itself, so an address alone cannot use up a signed webhook's budget.
    if (!perWebhook(hook.id)) return [429, 'Too many requests']
    // Looked up again in its turn: the webhook may have been paused, deleted or given a new address while it waited.
    const outcome = await inTurn(() => {
      const now = webhooks.find(token)
      return !now || now.id !== hook.id ? 'gone' : now.paused ? 'paused' : webhooks.receive(now, body, request.headers)
    })
    if (outcome === 'gone') return null
    if (outcome === 'paused') return [409, 'Webhook paused']
    if (outcome === 'full') return [429, 'Too many events waiting']
    return [202, outcome === 'duplicate' ? 'Already received' : 'Accepted']
  }
}
