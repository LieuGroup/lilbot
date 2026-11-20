/** `POST /hook/<address>` on the helper door: the one public route that wakes a bot. It answers at once; the run
 *  happens later. Unknown, deleted or malformed addresses, other methods and a deleted bot's webhooks all get the
 *  door's own 404 (null here). Nothing about a request is logged except refused signatures, by webhook id, at most once a minute each. */
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
    const outcome = webhooks.receive(hook, body, request.headers)
    if (outcome === 'full') return [429, 'Too many events waiting']
    return [202, outcome === 'duplicate' ? 'Already received' : 'Accepted']
  }
}
