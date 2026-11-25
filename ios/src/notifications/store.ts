/** App-level notification store instance and socket event watcher for iOS. */
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import { ensureSocket } from '../connection/lilbot'
import { thisDeviceId } from '../devices/device'
import { iosNotificationBridge } from './native-bridge'
import { createNotificationStore, type NotificationSocket } from './store-core'

const PROMPTED_KEY = 'lilbot.notifications.prompted'

export const useNotificationStore = createNotificationStore({
  getSocket: () => ensureSocket() as NotificationSocket | null,
  getDeviceId: thisDeviceId,
  bridge: iosNotificationBridge,
  channel: () => (__DEV__ ? 'apns_sandbox' : 'apns'),
  bundleId: () => Constants.expoConfig?.ios?.bundleIdentifier ?? 'com.lilbot.app',
  readPrompted: async () => {
    try {
      return (await AsyncStorage.getItem(PROMPTED_KEY)) === '1'
    } catch {
      return false
    }
  },
  writePrompted: async () => {
    try {
      await AsyncStorage.setItem(PROMPTED_KEY, '1')
    } catch {}
  }
})

/** Subscribes to server `notifications.changed` pushes so changes made on another device stay in sync. */
export function watchNotificationChanges(): () => void {
  const socket = ensureSocket()
  if (!socket) return () => {}
  return socket.onNotificationsChanged(() => void useNotificationStore.getState().sync({ registerIfGranted: false }))
}
