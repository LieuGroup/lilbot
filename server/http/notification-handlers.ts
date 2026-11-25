/** Browser/app WebSocket notification handlers and per-connection device presence wiring. */
import { LilBotError } from '../../shared/lilbot-error'
import type { Method } from '../../shared/protocol'
import type { NotificationService } from '../notifications/notification-service'
import type { Handlers } from './browser-session'

type NotificationMethod = Extract<Method, `notifications.${string}`>

export function createSessionNotifications(getService: () => NotificationService | undefined, sessionId: string) {
  let deviceId: string | undefined
  const require = () => {
    const service = getService()
    if (!service) throw new LilBotError('unavailable', 'Notifications are unavailable.')
    return service
  }
  const bindDevice = (id: string) => {
    deviceId = id
    getService()?.presence.bindDevice(sessionId, id)
  }
  const handlers: Pick<Handlers, NotificationMethod> = {
    'notifications.register': async ({ deviceId: id, channel, token, bundleId }) => {
      bindDevice(id)
      return require().register(id, channel, token, bundleId)
    },
    'notifications.unregister': async ({ deviceId: id, channel }) => {
      bindDevice(id)
      return require().unregister(id, channel)
    },
    'notifications.prefs.get': async ({ deviceId: id }) => {
      bindDevice(id)
      return require().getSettings(id)
    },
    'notifications.prefs.set': async ({ deviceId: id, ...patch }) => {
      bindDevice(id)
      return require().setDevicePrefs(id, patch)
    },
    'notifications.botPrefs.set': async ({ botId, muted }) => require().setBotPrefs(botId, muted),
    'notifications.presence': async ({ deviceId: id, foreground, botId }) => {
      bindDevice(id)
      return require().setPresence(sessionId, id, foreground, botId)
    }
  }
  return {
    handlers,
    bindDevice,
    touch: () => getService()?.presence.touch(sessionId),
    onView: (botId: string) => {
      getService()?.viewBot(sessionId, botId, deviceId)
      return () => getService()?.presence.unviewBot(sessionId, botId)
    },
    markRead: (botId: string) => getService()?.markRead(botId, deviceId),
    close: () => getService()?.presence.leave(sessionId)
  }
}
