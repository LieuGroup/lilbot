/** App-level notification store instance and socket event watcher for iOS. */
import Constants from 'expo-constants'
import { ensureSocket } from '../connection/lilbot'
import { thisDeviceId } from '../devices/device'
import { iosNotificationBridge } from './native-bridge'
import { createNotificationStore, type NotificationSocket } from './store-core'

export const useNotificationStore = createNotificationStore({
  getSocket: () => ensureSocket() as NotificationSocket | null,
  getDeviceId: thisDeviceId,
  bridge: iosNotificationBridge,
  channel: () => (__DEV__ ? 'apns_sandbox' : 'apns'),
  bundleId: () => Constants.expoConfig?.ios?.bundleIdentifier ?? 'com.lilbot.app'
})

/** Subscribes to server `notifications.changed` pushes so changes made on another device stay in sync. */
export function watchNotificationChanges(): () => void {
  const socket = ensureSocket()
  if (!socket) return () => {}
  return socket.onNotificationsChanged(() => void useNotificationStore.getState().sync({ registerIfGranted: false }))
}
