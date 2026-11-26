/** Pure Webhook display labels mirroring `web/src/webhooks/webhook-lines.ts`. */
import type { Webhook, WebhookRun } from '../../../shared/webhook-schema'
import { dayLabel, sessionTime } from '../ui/format-time'

const HOUR = 3_600_000

export function ago(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (now - at < 24 * HOUR) {
    const hours = Math.floor(minutes / 60)
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  }
  return `on ${dayLabel(at, now)}`
}

const lastEventText = (webhook: Webhook, now = Date.now()) =>
  webhook.lastEventAt === null ? 'no events yet' : `last event ${ago(webhook.lastEventAt, now)}`

export type WebhookTone = 'running' | 'failed' | 'paused' | 'plain'

export function webhookLine(webhook: Webhook, now = Date.now()): { text: string; tone: WebhookTone } {
  const latest = webhook.runs[0]
  const plain = `${webhook.source} · ${lastEventText(webhook, now)}`
  if (latest && (latest.status === 'running' || latest.status === 'pending')) {
    return { text: `Running now · ${webhook.source}`, tone: 'running' }
  }
  if (webhook.paused) return { text: `Paused · ${plain}`, tone: 'paused' }
  if (latest?.status === 'failed') return { text: `Last run failed · ${plain}`, tone: 'failed' }
  return { text: plain, tone: 'plain' }
}

export const webhookRunTitle = (run: WebhookRun, now = Date.now()) =>
  `${sessionTime(run.createdAt, now)} · ${run.events === 1 ? '1 event' : `${run.events} events`}`

export const createdWebhookText = (webhook: Webhook, botName: string) =>
  webhook.createdBy === 'oscar' ? 'You asked for it' : `${botName} made it`

export const deleteWebhookText = (webhook: Webhook) =>
  `Its address stops working at once, and its past runs are removed. ${webhook.source} will keep calling it until the bot or you remove it there.`
