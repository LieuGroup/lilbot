/** Tracks which bot each connected device is actively viewing in the foreground, expiring silent/half-open connections after `ttlMs`. */
export const DEFAULT_PRESENCE_TTL_MS = 120_000

interface ConnectionPresence {
  deviceId: string | null
  foreground: boolean
  viewedBots: Map<string, number>
  /** When set by `notifications.presence`, names the single bot on screen (or null on Roster/Settings), overriding cached open chats. */
  explicitBot: string | null | undefined
  updatedAt: number
}

export class DevicePresence {
  private connections = new Map<string, ConnectionPresence>()

  constructor(
    private now: () => number = Date.now,
    private ttlMs = DEFAULT_PRESENCE_TTL_MS
  ) {}

  private ensure(connectionId: string): ConnectionPresence {
    let entry = this.connections.get(connectionId)
    if (!entry) {
      entry = { deviceId: null, foreground: true, viewedBots: new Map(), explicitBot: undefined, updatedAt: this.now() }
      this.connections.set(connectionId, entry)
    }
    return entry
  }

  touch(connectionId: string) {
    const entry = this.connections.get(connectionId)
    if (entry) entry.updatedAt = this.now()
  }

  bindDevice(connectionId: string, deviceId: string) {
    const entry = this.ensure(connectionId)
    entry.deviceId = deviceId
    entry.updatedAt = this.now()
  }

  setPresence(connectionId: string, deviceId: string, foreground: boolean, botId?: string | null) {
    const entry = this.ensure(connectionId)
    entry.deviceId = deviceId
    entry.foreground = foreground
    entry.updatedAt = this.now()
    if (botId !== undefined) entry.explicitBot = botId
  }

  viewBot(connectionId: string, botId: string, deviceId?: string | null) {
    const entry = this.ensure(connectionId)
    if (deviceId) entry.deviceId = deviceId
    entry.updatedAt = this.now()
    entry.viewedBots.set(botId, (entry.viewedBots.get(botId) ?? 0) + 1)
  }

  unviewBot(connectionId: string, botId: string) {
    const entry = this.connections.get(connectionId)
    if (!entry) return
    entry.updatedAt = this.now()
    const next = (entry.viewedBots.get(botId) ?? 1) - 1
    if (next > 0) entry.viewedBots.set(botId, next)
    else entry.viewedBots.delete(botId)
  }

  leave(connectionId: string) {
    this.connections.delete(connectionId)
  }

  /** True only when `deviceId` itself has a fresh foreground connection currently showing `botId`. */
  isViewingBot(deviceId: string, botId: string): boolean {
    const now = this.now()
    for (const entry of this.connections.values()) {
      if (entry.deviceId !== deviceId || !entry.foreground) continue
      if (this.ttlMs > 0 && now - entry.updatedAt >= this.ttlMs) continue
      if (entry.explicitBot !== undefined) {
        if (entry.explicitBot === botId) return true
      } else if ((entry.viewedBots.get(botId) ?? 0) > 0) {
        return true
      }
    }
    return false
  }
}
