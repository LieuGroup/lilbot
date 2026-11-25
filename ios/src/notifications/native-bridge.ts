/** Native iOS notification bridge over `expo-notifications`.
 *  Uses Apple's raw APNs device token (`getDevicePushTokenAsync`), never the Expo push relay. */
import * as Notifications from 'expo-notifications'
import type { NotificationTarget } from '../../../shared/notification-schema'
import type { NotificationBridge } from './store-core'
import { parseNotificationTarget } from './tap-target'

let handlerInstalled = false

/** Suppresses foreground banners when the tapped/incoming notification belongs to the bot already on screen. */
export function installForegroundNotificationHandler(isViewingBot: (botId: string) => boolean) {
  if (handlerInstalled) return
  handlerInstalled = true
  Notifications.setNotificationHandler({
    handleNotification: async notification => {
      const target = parseNotificationTarget(notification.request.content.data)
      const sameBot = target && target.kind !== 'deploy' && isViewingBot(target.botId)
      return {
        shouldShowBanner: !sameBot,
        shouldShowList: !sameBot,
        shouldPlaySound: !sameBot,
        shouldSetBadge: false
      }
    }
  })
}

function mapPermission(status: Notifications.PermissionStatus): 'undetermined' | 'granted' | 'denied' {
  if (status === 'granted') return 'granted'
  if (status === 'denied') return 'denied'
  return 'undetermined'
}

export const iosNotificationBridge: NotificationBridge = {
  async getPermission() {
    try {
      const current = await Notifications.getPermissionsAsync()
      return mapPermission(current.status)
    } catch {
      return 'undetermined'
    }
  },
  async requestPermission() {
    try {
      const next = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } })
      return mapPermission(next.status)
    } catch {
      return 'denied'
    }
  },
  async getDeviceToken() {
    try {
      const token = await Notifications.getDevicePushTokenAsync()
      return typeof token.data === 'string' && token.data.length >= 8 ? token.data : null
    } catch {
      return null
    }
  }
}

/** Subscribes to cold-start and warm/background notification taps, delivering parsed `NotificationTarget`s. */
export function watchNotificationTaps(onTarget: (target: NotificationTarget) => void): () => void {
  let active = true
  void Notifications.getLastNotificationResponseAsync()
    .then(response => {
      if (!active || !response) return
      const target = parseNotificationTarget(response.notification.request.content.data)
      if (target) onTarget(target)
    })
    .catch(() => {})

  const sub = Notifications.addNotificationResponseReceivedListener(response => {
    const target = parseNotificationTarget(response.notification.request.content.data)
    if (target) onTarget(target)
  })
  return () => {
    active = false
    sub.remove()
  }
}
