/** Evaluates per-device rules synchronously before awaiting a bounded sender queue, updating durable delivery state. */
import type { DevicePresence } from './notification-presence'
import type { DeliveryQueue } from './notification-queue'
import { isEventEnabled, type ReplyCooldown } from './notification-rules'
import type { NotificationPayload, NotificationRecipient, NotificationSender } from './notification-sender'
import type { NotificationStore } from './notification-store'
import { formatNotification, type NotificationEvent } from './notification-text'

export interface DispatchSummary {
  sent: number
  suppressed: number
  deduped: number
  failed: number
}

export interface DispatchDeps {
  store: NotificationStore
  sender: NotificationSender
  queue: DeliveryQueue
  presence: DevicePresence
  cooldown: ReplyCooldown
  replyCooldownMs: number
  now: number
}

export interface DispatchOptions {
  suppressedDevices?: ReadonlySet<string>
  suppressWhenViewing?: boolean
  /** Invoked synchronously with every device that reserved a delivery slot, before awaiting the sender. */
  onReserved?: (deviceIds: readonly string[]) => void
  /** Invoked when a reserved delivery does not settle as `sent`, so callers can roll back pre-send reservations. */
  onFailed?: (deviceId: string) => void
}

interface ReservedDelivery {
  recipient: NotificationRecipient
  payload: NotificationPayload
}

/** Dispatches one event across every active endpoint whose channel has a configured sender.
 *  All suppression checks, cooldown reservations, and SQLite dedupe claims run synchronously before any `await`. */
export async function dispatchNotification(deps: DispatchDeps, event: NotificationEvent, options: DispatchOptions = {}): Promise<DispatchSummary> {
  const { store, sender, queue, presence, cooldown, replyCooldownMs, now } = deps
  const summary: DispatchSummary = { sent: 0, suppressed: 0, deduped: 0, failed: 0 }
  const botId = event.kind === 'deploy_failed' ? null : event.botId
  const botMuted = botId ? store.isBotMuted(botId) : false
  const suppressViewing = options.suppressWhenViewing ?? (event.kind === 'reply' || event.kind === 'turn_failed' || event.kind === 'needs_answer')

  const reserved: ReservedDelivery[] = []
  for (const recipient of store.activeEndpoints()) {
    if (!sender.channels.includes(recipient.channel)) continue
    const prefs = store.devicePrefs(recipient.deviceId)
    if (!isEventEnabled(prefs, botMuted, event.kind)) {
      summary.suppressed++
      continue
    }
    if (options.suppressedDevices?.has(recipient.deviceId)) {
      summary.suppressed++
      continue
    }
    if (botId && suppressViewing && presence.isViewingBot(recipient.deviceId, botId)) {
      summary.suppressed++
      continue
    }
    if (event.kind === 'reply' && botId) {
      const persisted = store.lastReplyAt(recipient.deviceId, botId)
      if (cooldown.inCooldown(recipient.deviceId, botId, now, replyCooldownMs, persisted)) {
        summary.suppressed++
        continue
      }
    }
    if (!store.claimDelivery(recipient.deviceId, event.dedupeKey, event.kind, botId, now)) {
      summary.deduped++
      continue
    }
    if (event.kind === 'reply' && botId) cooldown.recordSent(recipient.deviceId, botId, now)
    reserved.push({ recipient, payload: formatNotification(event, prefs.showPreview) })
  }

  if (reserved.length) {
    options.onReserved?.(reserved.map(item => item.recipient.deviceId))
  }

  const results = await Promise.all(
    reserved.map(async ({ recipient, payload }) => {
      const result = await queue.enqueue(() => sender.send(recipient, payload))
      try {
        store.markDelivery(recipient.deviceId, event.dedupeKey, result.status)
        if (result.status === 'invalid_token') store.removeEndpoint(recipient.deviceId, recipient.channel)
      } catch {
        console.error('[notifications] failed to record delivery outcome')
      }
      if (result.status !== 'sent') {
        if (event.kind === 'reply' && botId) cooldown.releaseReservation(recipient.deviceId, botId, now)
        options.onFailed?.(recipient.deviceId)
      }
      return result.status
    })
  )

  for (const status of results) {
    if (status === 'sent') summary.sent++
    else summary.failed++
  }
  return summary
}
