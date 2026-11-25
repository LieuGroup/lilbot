/** Pure Zustand store factory for iOS notification permission, device token registration, settings, and tap targets.
 *  Zero React Native runtime imports so unit tests verify every rule on Linux. */
import { create } from 'zustand'
import type {
  NotificationBotPrefs,
  NotificationChannel,
  NotificationDevicePrefs,
  NotificationEndpoint,
  NotificationPrefsPatch,
  NotificationSettings,
  NotificationTarget
} from '../../../shared/notification-schema'

export type NotificationPermission = 'unknown' | 'undetermined' | 'granted' | 'denied'

export interface NotificationSocket {
  call<T = unknown>(method: string, params: Record<string, unknown>): Promise<T>
}

export interface NotificationBridge {
  getPermission(): Promise<Exclude<NotificationPermission, 'unknown'>>
  requestPermission(): Promise<Exclude<NotificationPermission, 'unknown'>>
  /** Returns the raw Apple APNs hex device token (never an Expo push token). */
  getDeviceToken(): Promise<string | null>
}

export interface NotificationStoreDeps {
  getSocket: () => NotificationSocket | null
  getDeviceId: () => Promise<string>
  bridge: NotificationBridge
  channel: () => NotificationChannel
  bundleId: () => string
  readPrompted: () => Promise<boolean>
  writePrompted: () => Promise<void>
}

export interface NotificationStoreState {
  permission: NotificationPermission
  settings: NotificationSettings | null
  loading: boolean
  registering: boolean
  error: string
  promptedOnce: boolean
  registeredToken: string | null
  pendingTarget: NotificationTarget | null
  sync: (options?: { registerIfGranted?: boolean }) => Promise<void>
  enableAndRegister: () => Promise<boolean>
  promptOnFirstSend: () => Promise<void>
  updatePrefs: (patch: NotificationPrefsPatch) => Promise<void>
  setBotMuted: (botId: string, muted: boolean) => Promise<void>
  unregister: () => Promise<void>
  setPendingTarget: (target: NotificationTarget | null) => void
  consumePendingTarget: () => NotificationTarget | null
}

const errText = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback)
const toggleMuted = (ids: readonly string[], botId: string, muted: boolean) => (muted ? Array.from(new Set([...ids, botId])).sort() : ids.filter(id => id !== botId))

export function createNotificationStore(deps: NotificationStoreDeps) {
  let promptInFlight = false
  return create<NotificationStoreState>((set, get) => {
    const syncRegistration = async (deviceId: string, socket: NotificationSocket) => {
      const token = await deps.bridge.getDeviceToken()
      if (!token) return
      const endpoint = await socket.call<NotificationEndpoint>('notifications.register', { deviceId, channel: deps.channel(), token, bundleId: deps.bundleId() })
      set(state => ({
        registeredToken: token,
        settings: state.settings ? { ...state.settings, endpoints: [...state.settings.endpoints.filter(e => e.channel !== endpoint.channel), endpoint] } : state.settings
      }))
    }

    return {
      permission: 'unknown',
      settings: null,
      loading: false,
      registering: false,
      error: '',
      promptedOnce: false,
      registeredToken: null,
      pendingTarget: null,

      async sync(options = { registerIfGranted: true }) {
        const socket = deps.getSocket()
        if (!socket) return
        set({ loading: true, error: '' })
        try {
          const [deviceId, permission, promptedOnce] = await Promise.all([deps.getDeviceId(), deps.bridge.getPermission(), deps.readPrompted()])
          const settings = await socket.call<NotificationSettings>('notifications.prefs.get', { deviceId })
          set({ permission, settings, promptedOnce, loading: false })
          if (options.registerIfGranted && permission === 'granted' && settings.device.enabled) await syncRegistration(deviceId, socket)
        } catch (cause) {
          set({ loading: false, error: errText(cause, 'Could not load notification settings.') })
        }
      },

      async enableAndRegister() {
        const socket = deps.getSocket()
        if (!socket) return false
        set({ registering: true, error: '' })
        try {
          const current = await deps.bridge.getPermission()
          const permission = current === 'granted' ? 'granted' : await deps.bridge.requestPermission()
          await deps.writePrompted()
          set({ permission, promptedOnce: true })
          if (permission !== 'granted') {
            set({ registering: false })
            return false
          }
          const deviceId = await deps.getDeviceId()
          const device = await socket.call<NotificationDevicePrefs>('notifications.prefs.set', { deviceId, enabled: true })
          set(state => ({ settings: state.settings ? { ...state.settings, device } : state.settings }))
          await syncRegistration(deviceId, socket)
          const fresh = await socket.call<NotificationSettings>('notifications.prefs.get', { deviceId })
          set({ settings: fresh, registering: false })
          return true
        } catch (cause) {
          set({ registering: false, error: errText(cause, 'Could not enable notifications.') })
          return false
        }
      },

      async promptOnFirstSend() {
        if (promptInFlight || get().promptedOnce) return
        promptInFlight = true
        try {
          if (await deps.readPrompted()) {
            set({ promptedOnce: true })
            return
          }
          const permission = await deps.bridge.getPermission()
          set({ permission })
          if (permission !== 'undetermined') {
            await deps.writePrompted()
            set({ promptedOnce: true })
            if (permission === 'granted') await get().sync({ registerIfGranted: true })
            return
          }
          await get().enableAndRegister()
        } finally {
          promptInFlight = false
        }
      },

      async updatePrefs(patch) {
        const socket = deps.getSocket()
        if (!socket) return
        const prev = get().settings
        if (prev) set({ settings: { ...prev, device: { ...prev.device, ...patch } }, error: '' })
        try {
          const deviceId = await deps.getDeviceId()
          const device = await socket.call<NotificationDevicePrefs>('notifications.prefs.set', { deviceId, ...patch })
          set(state => ({ settings: state.settings ? { ...state.settings, device } : state.settings }))
          if (patch.enabled === true && get().permission === 'granted') await syncRegistration(deviceId, socket)
        } catch (cause) {
          set({ settings: prev, error: errText(cause, 'Could not update notification settings.') })
        }
      },

      async setBotMuted(botId, muted) {
        const socket = deps.getSocket()
        if (!socket) return
        const prev = get().settings
        if (prev) set({ settings: { ...prev, mutedBotIds: toggleMuted(prev.mutedBotIds, botId, muted) }, error: '' })
        try {
          const saved = await socket.call<NotificationBotPrefs>('notifications.botPrefs.set', { botId, muted })
          set(state =>
            state.settings ? { settings: { ...state.settings, mutedBotIds: toggleMuted(state.settings.mutedBotIds, saved.botId, saved.muted) } } : state
          )
        } catch (cause) {
          set({ settings: prev, error: errText(cause, 'Could not update bot mute.') })
        }
      },

      async unregister() {
        const socket = deps.getSocket()
        if (!socket) return
        const deviceId = await deps.getDeviceId()
        await socket.call('notifications.unregister', { deviceId, channel: deps.channel() })
        set(state => ({
          registeredToken: null,
          settings: state.settings ? { ...state.settings, endpoints: state.settings.endpoints.filter(e => e.channel !== deps.channel()) } : state.settings
        }))
      },

      setPendingTarget: target => set({ pendingTarget: target }),

      consumePendingTarget() {
        const target = get().pendingTarget
        if (target) set({ pendingTarget: null })
        return target
      }
    }
  })
}
