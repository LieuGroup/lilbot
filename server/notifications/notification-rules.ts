/** Pure decision rules for notifications: preferences, long-work filter, per-device foreground presence, per-turn dedupe, and reply cooldown. */
import type { NotificationDevicePrefs, NotificationKind } from '../../shared/notification-schema'
import type { WorkSummary } from '../../shared/work-schema'

export const DEFAULT_LONG_WORK_MS = 2 * 60_000
export const DEFAULT_REPLY_COOLDOWN_MS = 30_000

export function isEventEnabled(prefs: NotificationDevicePrefs, botMuted: boolean, kind: NotificationKind): boolean {
  if (!prefs.enabled) return false
  if (kind !== 'deploy_failed' && botMuted) return false
  switch (kind) {
    case 'reply':
      return prefs.replies
    case 'needs_answer':
      return prefs.needsAnswer
    case 'turn_failed':
      return prefs.turnFailed
    case 'work_done':
      return prefs.workDone
    case 'deploy_failed':
      return prefs.deployFailed
  }
}

/** Qualifies a finished work item for a `work_done` alert: top-level only, failed or checked (>= 2) or ran >= threshold. */
export function shouldNotifyWorkDone(
  item: Pick<WorkSummary, 'parentId' | 'status' | 'checkLevel' | 'startedAt' | 'createdAt' | 'finishedAt' | 'updatedAt'>,
  longWorkMs = DEFAULT_LONG_WORK_MS
): boolean {
  if (item.parentId !== null) return false
  if (item.status !== 'done' && item.status !== 'failed') return false
  if (item.status === 'failed' || item.checkLevel >= 2) return true
  const start = item.startedAt ?? item.createdAt
  const end = item.finishedAt ?? item.updatedAt
  return end - start >= longWorkMs
}

interface ConnectionPresence {
  deviceId: string | null
  foreground: boolean
  viewedBots: Map<string, number>
  /** When set by `notifications.presence`, names the single bot on screen (or null on Roster/Settings), overriding cached open chats. */
  explicitBot: string | null | undefined
}

/** Tracks which bot each connected device is actively viewing in the foreground. Another device never silences this one. */
export class DevicePresence {
  private connections = new Map<string, ConnectionPresence>()

  private ensure(connectionId: string): ConnectionPresence {
    let entry = this.connections.get(connectionId)
    if (!entry) {
      entry = { deviceId: null, foreground: true, viewedBots: new Map(), explicitBot: undefined }
      this.connections.set(connectionId, entry)
    }
    return entry
  }

  bindDevice(connectionId: string, deviceId: string) {
    this.ensure(connectionId).deviceId = deviceId
  }

  setPresence(connectionId: string, deviceId: string, foreground: boolean, botId?: string | null) {
    const entry = this.ensure(connectionId)
    entry.deviceId = deviceId
    entry.foreground = foreground
    if (botId !== undefined) entry.explicitBot = botId
  }

  viewBot(connectionId: string, botId: string, deviceId?: string | null) {
    const entry = this.ensure(connectionId)
    if (deviceId) entry.deviceId = deviceId
    entry.viewedBots.set(botId, (entry.viewedBots.get(botId) ?? 0) + 1)
  }

  unviewBot(connectionId: string, botId: string) {
    const viewed = this.connections.get(connectionId)?.viewedBots
    if (!viewed) return
    const next = (viewed.get(botId) ?? 1) - 1
    if (next > 0) viewed.set(botId, next)
    else viewed.delete(botId)
  }

  leave(connectionId: string) {
    this.connections.delete(connectionId)
  }

  /** True only when `deviceId` itself has an active foreground connection currently showing `botId`. */
  isViewingBot(deviceId: string, botId: string): boolean {
    for (const entry of this.connections.values()) {
      if (entry.deviceId !== deviceId || !entry.foreground) continue
      if (entry.explicitBot !== undefined) {
        if (entry.explicitBot === botId) return true
      } else if ((entry.viewedBots.get(botId) ?? 0) > 0) {
        return true
      }
    }
    return false
  }
}

interface TurnState {
  active: boolean
  workAlertedDevices: Set<string>
}

/** Ensures a turn that already alerted a device for a finished work item does not also fire a duplicate reply alert. */
export class TurnAlertTracker {
  private turns = new Map<string, TurnState>()
  private key = (botId: string, chatId: string) => `${botId}\n${chatId}`

  turnStarted(botId: string, chatId: string) {
    this.turns.set(this.key(botId, chatId), { active: true, workAlertedDevices: new Set() })
  }

  /** Marks devices alerted by `work_done` for the current turn, unless we already know that turn has ended. */
  recordWorkAlerted(botId: string, chatId: string, deviceIds: readonly string[]) {
    if (!deviceIds.length) return
    const k = this.key(botId, chatId)
    const current = this.turns.get(k)
    if (current && !current.active) return
    const state = current ?? { active: true, workAlertedDevices: new Set<string>() }
    for (const id of deviceIds) state.workAlertedDevices.add(id)
    this.turns.set(k, state)
  }

  /** Consumes and closes the turn's alert state, returning devices that already received a `work_done` alert in this turn. */
  consumeReplySuppressed(botId: string, chatId: string): Set<string> {
    const k = this.key(botId, chatId)
    const current = this.turns.get(k)
    const suppressed = current ? new Set(current.workAlertedDevices) : new Set<string>()
    this.turns.set(k, { active: false, workAlertedDevices: new Set() })
    return suppressed
  }

  turnEnded(botId: string, chatId: string) {
    this.turns.set(this.key(botId, chatId), { active: false, workAlertedDevices: new Set() })
  }

  forgetBot(botId: string) {
    const prefix = `${botId}\n`
    for (const k of this.turns.keys()) if (k.startsWith(prefix)) this.turns.delete(k)
  }
}

/** Per-(device, bot) quiet window for ordinary replies; urgent alerts bypass it and opening/reading the bot clears it. */
export class ReplyCooldown {
  private lastSent = new Map<string, number>()
  private key = (deviceId: string, botId: string) => `${deviceId}\n${botId}`

  inCooldown(deviceId: string, botId: string, now: number, cooldownMs = DEFAULT_REPLY_COOLDOWN_MS): boolean {
    if (cooldownMs <= 0) return false
    const last = this.lastSent.get(this.key(deviceId, botId))
    return last !== undefined && now - last < cooldownMs
  }

  recordSent(deviceId: string, botId: string, now: number) {
    this.lastSent.set(this.key(deviceId, botId), now)
  }

  clearBot(botId: string, deviceId?: string) {
    if (deviceId) {
      this.lastSent.delete(this.key(deviceId, botId))
      return
    }
    const suffix = `\n${botId}`
    for (const k of this.lastSent.keys()) if (k.endsWith(suffix)) this.lastSent.delete(k)
  }
}
