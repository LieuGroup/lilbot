/** Pure decision rules for notifications: preferences, long-work filter, same-turn work suppression, and reply cooldown. */
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

interface TurnState {
  active: boolean
  workAlertedDevices: Set<string>
}

/** Tracks per-turn `work_done` alerts so a reply for the same turn does not double-notify devices already alerted. */
export class TurnAlertTracker {
  private turns = new Map<string, TurnState>()
  private key = (botId: string, chatId: string) => `${botId}\n${chatId}`

  turnStarted(botId: string, chatId: string) {
    const k = this.key(botId, chatId)
    if (this.turns.get(k)?.active) return
    this.turns.set(k, { active: true, workAlertedDevices: new Set() })
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

  /** Releases a device's suppression reservation when its `work_done` push fails so the turn's reply can still notify. */
  releaseWorkAlerted(botId: string, chatId: string, deviceId: string) {
    const current = this.turns.get(this.key(botId, chatId))
    if (current?.active) current.workAlertedDevices.delete(deviceId)
  }

  /** Closes the current turn and returns the devices already notified by `work_done` during it. */
  finishTurn(botId: string, chatId: string): Set<string> {
    const k = this.key(botId, chatId)
    const current = this.turns.get(k)
    const suppressed = current ? new Set(current.workAlertedDevices) : new Set<string>()
    this.turns.set(k, { active: false, workAlertedDevices: new Set() })
    return suppressed
  }

  forgetBot(botId: string) {
    const prefix = `${botId}\n`
    for (const k of this.turns.keys()) if (k.startsWith(prefix)) this.turns.delete(k)
  }
}

/** Per-(device, bot) quiet window for ordinary replies; combines in-flight reservations with persisted delivery timestamps across restarts. */
export class ReplyCooldown {
  private lastSent = new Map<string, number>()
  private clearedAt = new Map<string, number>()
  private key = (deviceId: string, botId: string) => `${deviceId}\n${botId}`

  inCooldown(deviceId: string, botId: string, now: number, cooldownMs = DEFAULT_REPLY_COOLDOWN_MS, persistedLastAt?: number | null): boolean {
    if (cooldownMs <= 0) return false
    const k = this.key(deviceId, botId)
    const mem = this.lastSent.get(k)
    const cleared = this.clearedAt.get(k) ?? -Infinity
    const persisted = persistedLastAt != null && persistedLastAt > cleared ? persistedLastAt : undefined
    const last = mem !== undefined && persisted !== undefined ? Math.max(mem, persisted) : (mem ?? persisted)
    return last !== undefined && now - last < cooldownMs
  }

  recordSent(deviceId: string, botId: string, now: number) {
    this.lastSent.set(this.key(deviceId, botId), now)
  }

  /** Releases a pre-send reservation if that exact send failed and no newer send replaced it. */
  releaseReservation(deviceId: string, botId: string, reservedAt: number) {
    const k = this.key(deviceId, botId)
    if (this.lastSent.get(k) === reservedAt) this.lastSent.delete(k)
  }

  clearBot(botId: string, deviceId?: string, now = Date.now()) {
    if (deviceId) {
      const k = this.key(deviceId, botId)
      this.lastSent.delete(k)
      this.clearedAt.set(k, now)
      return
    }
    const suffix = `\n${botId}`
    for (const k of this.lastSent.keys()) {
      if (k.endsWith(suffix)) {
        this.lastSent.delete(k)
        this.clearedAt.set(k, now)
      }
    }
  }
}
