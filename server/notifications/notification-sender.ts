/** Pluggable notification delivery interface and in-memory test sender (no external network calls). */
import type { NotificationChannel, NotificationKind, NotificationTarget } from '../../shared/notification-schema'

export interface NotificationPayload {
  kind: NotificationKind
  title: string
  body: string
  /** Grouping key (maps to APNs `thread-id`). */
  threadId: string
  /** Optional replacement key (maps to APNs `apns-collapse-id`, kept <= 64 ASCII bytes). */
  collapseId?: string
  priority: 'normal' | 'urgent'
  target: NotificationTarget
  dedupeKey: string
  createdAt: number
}

export interface NotificationRecipient {
  deviceId: string
  channel: NotificationChannel
  token: string
  bundleId: string
}

export type NotificationSendResult = { status: 'sent' } | { status: 'invalid_token'; reason: string } | { status: 'failed'; reason: string }

export interface NotificationSender {
  readonly channels: readonly NotificationChannel[]
  send(recipient: NotificationRecipient, payload: NotificationPayload): Promise<NotificationSendResult>
}

export interface RecordedNotification {
  recipient: NotificationRecipient
  payload: NotificationPayload
}

/** Routes each recipient's channel to the matching sender, or reports `no_sender` when none is registered. */
export function routeSenders(senders: readonly NotificationSender[]): NotificationSender {
  const byChannel = new Map<NotificationChannel, NotificationSender>()
  for (const sender of senders) {
    for (const channel of sender.channels) byChannel.set(channel, sender)
  }
  return {
    channels: [...byChannel.keys()],
    async send(recipient, payload) {
      const sender = byChannel.get(recipient.channel)
      if (!sender) return { status: 'failed', reason: 'no_sender' }
      return sender.send(recipient, payload)
    }
  }
}

/** In-memory sender for tests and development: records every delivery without touching external services. */
export class TestNotificationSender implements NotificationSender {
  readonly channels: readonly NotificationChannel[]
  readonly sent: RecordedNotification[] = []
  private handler?: (recipient: NotificationRecipient, payload: NotificationPayload) => NotificationSendResult | Promise<NotificationSendResult>

  constructor(
    channels: readonly NotificationChannel[] = ['test', 'apns', 'apns_sandbox'],
    handler?: (recipient: NotificationRecipient, payload: NotificationPayload) => NotificationSendResult | Promise<NotificationSendResult>
  ) {
    this.channels = channels
    this.handler = handler
  }

  setHandler(handler?: (recipient: NotificationRecipient, payload: NotificationPayload) => NotificationSendResult | Promise<NotificationSendResult>) {
    this.handler = handler
  }

  async send(recipient: NotificationRecipient, payload: NotificationPayload): Promise<NotificationSendResult> {
    this.sent.push({ recipient, payload })
    if (this.handler) return await this.handler(recipient, payload)
    return { status: 'sent' }
  }

  clear() {
    this.sent.length = 0
  }
}
