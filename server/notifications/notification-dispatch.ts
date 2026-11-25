/** Evaluates per-device rules, claims durable dedupe slots, and sends payloads through the configured sender. */
import { type DevicePresence, isEventEnabled, type ReplyCooldown } from './notification-rules'
import type { NotificationSender, NotificationSendResult } from './notification-sender'
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
  presence: DevicePresence
  cooldown: ReplyCooldown
  replyCooldownMs: number
  now: number
}

export interface DispatchOptions {
  suppressedDevices?: ReadonlySet<string>
  suppressWhenViewing?: boolean
  onSent?: (deviceId: string) => void
}

/** Dispatches one event across every active endpoint whose channel has a configured sender. */
export async function dispatchNotification(deps: DispatchDeps, event: NotificationEvent, options: DispatchOptions = {}): Promise<DispatchSummary> {
  const { store, sender, presence, cooldown, replyCooldownMs, now } = deps
  const summary: DispatchSummary = { sent: 0, suppressed: 0, deduped: 0, failed: 0 }
  const botId = event.kind === 'deploy_failed' ? null : event.botId
  const botMuted = botId ? store.isBotMuted(botId) : false
  const suppressViewing = options.suppressWhenViewing ?? (event.kind === 'reply' || event.kind === 'turn_failed')

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
    if (event.kind === 'reply' && botId && cooldown.inCooldown(recipient.deviceId, botId, now, replyCooldownMs)) {
      summary.suppressed++
      continue
    }
    if (!store.claimDelivery(recipient.deviceId, event.dedupeKey, event.kind, botId, now)) {
      summary.deduped++
      continue
    }
    const payload = formatNotification(event, prefs.showPreview)
    let result: NotificationSendResult
    try {
      result = await sender.send(recipient, payload)
    } catch {
      result = { status: 'failed', reason: 'sender_error' }
    }
    store.markDelivery(recipient.deviceId, event.dedupeKey, result.status)
    if (result.status === 'sent') {
      summary.sent++
      if (event.kind === 'reply' && botId) cooldown.recordSent(recipient.deviceId, botId, now)
      options.onSent?.(recipient.deviceId)
    } else if (result.status === 'invalid_token') {
      summary.failed++
      store.disableEndpoint(recipient.deviceId, recipient.channel, result.reason, now)
    } else {
      summary.failed++
    }
  }
  return summary
}
