/** The words the Webhooks screens show (Paper "17 Skills and webhooks" frames 4 to 6): a row's state line, a run's title,
 *  the facts and the delete question. Pure functions only; times are in the device's zone. */
import type { Webhook, WebhookRun } from '../../../shared/webhook-schema'
import { dayLabel, sessionTime } from '../history/history-labels'

const HOUR = 3_600_000

/** "just now", "5 min ago", "2 hours ago", then the day ("Mon 9 Nov") after a day. */
export function ago(at: number, now = Date.now()) {
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (now - at < 24 * HOUR) {
    const hours = Math.floor(minutes / 60)
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  }
  return `on ${dayLabel(at, now)}`
}

const lastEventText = (webhook: Webhook, now = Date.now()) => (webhook.lastEventAt === null ? 'no events yet' : `last event ${ago(webhook.lastEventAt, now)}`)

export type WebhookTone = 'running' | 'failed' | 'paused' | 'plain'

/** A webhook's second line in the list: a run under way, else paused, else a failed last run, else its source and last
 *  event ("GitHub · last event 2 hours ago"). */
export function webhookLine(webhook: Webhook, now = Date.now()): { text: string; tone: WebhookTone } {
  const latest = webhook.runs[0]
  const plain = `${webhook.source} · ${lastEventText(webhook, now)}`
  if (latest && (latest.status === 'running' || latest.status === 'pending')) return { text: `Running now · ${webhook.source}`, tone: 'running' }
  if (webhook.paused) return { text: `Paused · ${plain}`, tone: 'paused' }
  if (latest?.status === 'failed') return { text: `Last run failed · ${plain}`, tone: 'failed' }
  return { text: plain, tone: 'plain' }
}

/** "Today 14:12 · 3 events": when the run's first event came and how many it took. */
export const runTitle = (run: WebhookRun, now = Date.now()) => `${sessionTime(run.createdAt, now)} · ${run.events === 1 ? '1 event' : `${run.events} events`}`

/** Who made it: Oscar's request or the bot's own idea. */
export const createdText = (webhook: Webhook, botName: string) => (webhook.createdBy === 'oscar' ? 'You asked for it' : `${botName} made it`)

export const deleteText = (webhook: Webhook) =>
  `Its address stops working at once, and its past runs are removed. ${webhook.source} will keep calling it until the bot or you remove it there.`
