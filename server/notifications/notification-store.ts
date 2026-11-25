/** SQLite storage for push endpoints, per-device/per-bot preferences, and durable delivery deduplication. */
import type { Database } from 'bun:sqlite'
import type {
  NotificationBotPrefs,
  NotificationChannel,
  NotificationDevicePrefs,
  NotificationEndpoint,
  NotificationKind,
  NotificationPrefsPatch
} from '../../shared/notification-schema'
import type { NotificationRecipient } from './notification-sender'

type EndpointRow = { device_id: string; channel: NotificationChannel; token: string; bundle_id: string; enabled: number; disabled_reason: string | null; updated_at: number }
type PrefsRow = { device_id: string; enabled: number; show_preview: number; replies: number; needs_answer: number; turn_failed: number; work_done: number; deploy_failed: number }

const endpointView = (r: EndpointRow): NotificationEndpoint => ({
  deviceId: r.device_id,
  channel: r.channel,
  bundleId: r.bundle_id,
  enabled: Boolean(r.enabled),
  disabledReason: r.disabled_reason,
  updatedAt: r.updated_at
})

const recipientView = (r: EndpointRow): NotificationRecipient => ({ deviceId: r.device_id, channel: r.channel, token: r.token, bundleId: r.bundle_id })

function defaultDevicePrefs(deviceId: string): NotificationDevicePrefs {
  return { deviceId, enabled: true, showPreview: false, replies: true, needsAnswer: true, turnFailed: true, workDone: true, deployFailed: true }
}

const prefsView = (r: PrefsRow): NotificationDevicePrefs => ({
  deviceId: r.device_id,
  enabled: Boolean(r.enabled),
  showPreview: Boolean(r.show_preview),
  replies: Boolean(r.replies),
  needsAnswer: Boolean(r.needs_answer),
  turnFailed: Boolean(r.turn_failed),
  workDone: Boolean(r.work_done),
  deployFailed: Boolean(r.deploy_failed)
})

const ENDPOINT_COLS = 'device_id, channel, token, bundle_id, enabled, disabled_reason, updated_at'
const PREFS_COLS = 'device_id, enabled, show_preview, replies, needs_answer, turn_failed, work_done, deploy_failed'

export class NotificationStore {
  constructor(private db: Database) {}

  /** Registers or refreshes one device's push token, removing any stale duplicate binding of the same token on another device id. */
  register(deviceId: string, channel: NotificationChannel, token: string, bundleId: string, now: number): NotificationEndpoint {
    return this.db.transaction(() => {
      this.db.query('DELETE FROM notification_endpoints WHERE channel = ? AND token = ? AND device_id <> ?').run(channel, token, deviceId)
      this.db
        .query(
          `INSERT INTO notification_endpoints(device_id, channel, token, bundle_id, enabled, disabled_reason, created_at, updated_at) VALUES(?, ?, ?, ?, 1, NULL, ?, ?)
           ON CONFLICT(device_id, channel) DO UPDATE SET token=excluded.token, bundle_id=excluded.bundle_id, enabled=1, disabled_reason=NULL, updated_at=excluded.updated_at`
        )
        .run(deviceId, channel, token, bundleId, now, now)
      return endpointView(this.db.query(`SELECT ${ENDPOINT_COLS} FROM notification_endpoints WHERE device_id = ? AND channel = ?`).get(deviceId, channel) as EndpointRow)
    })()
  }

  unregister(deviceId: string, channel?: NotificationChannel): number {
    if (channel) return this.db.query('DELETE FROM notification_endpoints WHERE device_id = ? AND channel = ?').run(deviceId, channel).changes
    return this.db.query('DELETE FROM notification_endpoints WHERE device_id = ?').run(deviceId).changes
  }

  disableEndpoint(deviceId: string, channel: NotificationChannel, reason: string, now: number) {
    this.db
      .query('UPDATE notification_endpoints SET enabled = 0, disabled_reason = ?, updated_at = ? WHERE device_id = ? AND channel = ?')
      .run(reason.slice(0, 200), now, deviceId, channel)
  }

  activeEndpoints(): NotificationRecipient[] {
    const rows = this.db
      .query(
        `SELECT e.device_id, e.channel, e.token, e.bundle_id, e.enabled, e.disabled_reason, e.updated_at FROM notification_endpoints e INNER JOIN devices d ON d.id = e.device_id WHERE e.enabled = 1 ORDER BY e.updated_at DESC`
      )
      .all() as EndpointRow[]
    return rows.map(recipientView)
  }

  endpointsForDevice(deviceId: string): NotificationEndpoint[] {
    return (this.db.query(`SELECT ${ENDPOINT_COLS} FROM notification_endpoints WHERE device_id = ? ORDER BY channel`).all(deviceId) as EndpointRow[]).map(endpointView)
  }

  devicePrefs(deviceId: string): NotificationDevicePrefs {
    const row = this.db.query(`SELECT ${PREFS_COLS} FROM notification_device_prefs WHERE device_id = ?`).get(deviceId) as PrefsRow | null
    return row ? prefsView(row) : defaultDevicePrefs(deviceId)
  }

  setDevicePrefs(deviceId: string, patch: NotificationPrefsPatch, now: number): NotificationDevicePrefs {
    const next: NotificationDevicePrefs = { ...this.devicePrefs(deviceId), ...patch, deviceId }
    this.db
      .query(
        `INSERT INTO notification_device_prefs(${PREFS_COLS}, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET enabled=excluded.enabled, show_preview=excluded.show_preview, replies=excluded.replies,
           needs_answer=excluded.needs_answer, turn_failed=excluded.turn_failed, work_done=excluded.work_done, deploy_failed=excluded.deploy_failed, updated_at=excluded.updated_at`
      )
      .run(
        deviceId,
        Number(next.enabled),
        Number(next.showPreview),
        Number(next.replies),
        Number(next.needsAnswer),
        Number(next.turnFailed),
        Number(next.workDone),
        Number(next.deployFailed),
        now
      )
    return next
  }

  isBotMuted(botId: string): boolean {
    return Boolean((this.db.query('SELECT muted FROM notification_bot_prefs WHERE bot_id = ?').get(botId) as { muted: number } | null)?.muted)
  }

  mutedBotIds(): string[] {
    return (this.db.query('SELECT bot_id FROM notification_bot_prefs WHERE muted = 1 ORDER BY bot_id').all() as { bot_id: string }[]).map(r => r.bot_id)
  }

  setBotMuted(botId: string, muted: boolean, now: number): NotificationBotPrefs {
    this.db
      .query(
        'INSERT INTO notification_bot_prefs(bot_id, muted, updated_at) VALUES(?, ?, ?) ON CONFLICT(bot_id) DO UPDATE SET muted = excluded.muted, updated_at = excluded.updated_at'
      )
      .run(botId, Number(muted), now)
    return { botId, muted }
  }

  /** Atomically claims a `(deviceId, dedupeKey)` slot so restarts and duplicate events never re-send. */
  claimDelivery(deviceId: string, dedupeKey: string, kind: NotificationKind, botId: string | null, at: number): boolean {
    return (
      this.db
        .query('INSERT OR IGNORE INTO notification_deliveries(device_id, dedupe_key, kind, bot_id, at, status) VALUES(?, ?, ?, ?, ?, ?)')
        .run(deviceId, dedupeKey, kind, botId, at, 'pending').changes > 0
    )
  }

  markDelivery(deviceId: string, dedupeKey: string, status: 'sent' | 'invalid_token' | 'failed') {
    this.db.query('UPDATE notification_deliveries SET status = ? WHERE device_id = ? AND dedupe_key = ?').run(status, deviceId, dedupeKey)
  }

  forgetBot(botId: string) {
    this.db.query('DELETE FROM notification_bot_prefs WHERE bot_id = ?').run(botId)
    this.db.query('DELETE FROM notification_deliveries WHERE bot_id = ?').run(botId)
  }

  pruneDeliveries(beforeMs: number) {
    this.db.query('DELETE FROM notification_deliveries WHERE at < ?').run(beforeMs)
  }
}
