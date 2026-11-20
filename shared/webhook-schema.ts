/** Webhooks (#12): an outside service calls a bot's secret address, and the bot runs the webhook's task with the
 *  events that arrived. The address and any signing secret are never part of a webhook's listed data. */
import { z } from 'zod'
import type { ChatSnapshot } from './chat-schema'

const secret = z.string().min(16).max(500)
/** How the sender signs its deliveries: GitHub (`X-Hub-Signature-256`), Stripe (`Stripe-Signature`), or an
 *  HMAC-SHA256 of the body in a header the sender names. Without a secret LilBot makes one (not for Stripe,
 *  which makes its own). */
export const WebhookSigning = z.discriminatedUnion('scheme', [
  z.object({ scheme: z.literal('github'), secret: secret.optional() }),
  z.object({ scheme: z.literal('stripe'), secret }),
  z.object({ scheme: z.literal('hmac-sha256'), header: z.string().regex(/^[A-Za-z0-9-]{1,64}$/), secret: secret.optional() })
])
export type WebhookSigning = z.infer<typeof WebhookSigning>
export const WebhookCreate = z.object({
  requestId: z.string().min(1).max(200),
  /** What the bot does when events arrive. */
  description: z.string().trim().min(1).max(20_000),
  /** The service that calls it, such as GitHub. */
  source: z.string().trim().min(1).max(60),
  createdBy: z.enum(['oscar', 'bot']),
  signing: WebhookSigning.optional()
})
export type WebhookCreate = z.infer<typeof WebhookCreate>

export interface WebhookRun {
  id: string
  webhookId: string
  botId: string
  createdAt: number
  /** Events merged into this run. */
  events: number
  startedAt: number | null
  finishedAt: number | null
  chatId: string | null
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped'
  result: string
}
export interface Webhook {
  id: string
  botId: string
  description: string
  source: string
  createdBy: 'oscar' | 'bot'
  /** The signature scheme deliveries must carry, or null when the address alone is the secret. */
  signing: WebhookSigning['scheme'] | null
  paused: boolean
  createdAt: number
  lastEventAt: number | null
  /** The newest 50. */
  runs: WebhookRun[]
}
/** Given only when a webhook is made or gets a new address. `signingSecret` only when LilBot made it. */
export interface WebhookAddress {
  id: string
  address: string
  signingSecret?: string
}

const botId = z.string().min(1)
const id = z.string().min(1)
/** The browser's webhook methods, merged into `methods` in `protocol.ts`. */
export const webhookMethods = {
  'webhooks.list': z.object({ botId }),
  'webhooks.pause': z.object({ botId, id }),
  'webhooks.resume': z.object({ botId, id }),
  /** The address stops working at once. */
  'webhooks.delete': z.object({ botId, id }),
  'webhooks.openRun': z.object({ botId, runId: id }),
  /** The secret address, for the Copy button only. */
  'webhooks.address': z.object({ botId, id })
} as const
export interface WebhookResults {
  'webhooks.list': Webhook[]
  'webhooks.pause': { ok: true }
  'webhooks.resume': { ok: true }
  'webhooks.delete': { ok: true }
  'webhooks.openRun': ChatSnapshot
  'webhooks.address': { address: string }
}
