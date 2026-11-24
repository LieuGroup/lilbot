/** Pure connection settings store factory: keeps server address loading/saving independent of Keychain
 *  failures, never writes blank tokens to Keychain, and maps Keychain errors to plain user-facing messages.
 *  Zero React Native/Expo imports so unit tests run directly on Linux. */
import { create } from 'zustand'
import type { Device } from '../../../shared/device-schema'

export const SETTINGS_KEY = 'lilbot.settings'
export const TOKEN_KEY = 'lilbot.accessToken'

export const CONNECTION_STORE_MESSAGES = {
  readTokenFailed: 'Could not read the saved access token on this device.',
  saveTokenFailed: 'Saved the server address, but could not store the access token on this device.',
  saveAddressFailed: 'Could not save the server address on this device.'
} as const

export interface ServerSettings {
  serverUrl: string
  accessToken: string
}

export interface PlainStorage {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
}

export interface SecretStorage {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  deleteItem: (key: string) => Promise<void>
}

export interface SaveConnectionOptions {
  /** Only clear a previously unreadable Keychain token when the user explicitly edited the token field. */
  clearToken?: boolean
}

export interface ConnectionState {
  settings: ServerSettings | null
  loaded: boolean
  connected: boolean
  device: Device | null
  tokenNotice: string
  tokenReadFailed: boolean
  load: () => Promise<void>
  retryTokenRead: () => Promise<void>
  save: (settings: ServerSettings, options?: SaveConnectionOptions) => Promise<void>
  setConnected: (connected: boolean) => void
  setDevice: (device: Device) => void
}

function parseSavedAddress(raw: string | null): string | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { serverUrl?: unknown }
    return typeof parsed.serverUrl === 'string' && parsed.serverUrl ? parsed.serverUrl : null
  } catch {
    return null
  }
}

export function createConnectionStore(deps: { plain: PlainStorage; secret: SecretStorage }) {
  return create<ConnectionState>((set, get) => ({
    settings: null,
    loaded: false,
    connected: false,
    device: null,
    tokenNotice: '',
    tokenReadFailed: false,
    load: async () => {
      let serverUrl: string | null = null
      try {
        serverUrl = parseSavedAddress(await deps.plain.getItem(SETTINGS_KEY))
      } catch {
        set({ loaded: true })
        return
      }
      if (!serverUrl) {
        set({ settings: null, loaded: true, tokenNotice: '', tokenReadFailed: false })
        return
      }
      try {
        const token = await deps.secret.getItem(TOKEN_KEY)
        set({ settings: { serverUrl, accessToken: token ?? '' }, loaded: true, tokenNotice: '', tokenReadFailed: false })
      } catch {
        set({
          settings: { serverUrl, accessToken: '' },
          loaded: true,
          tokenNotice: CONNECTION_STORE_MESSAGES.readTokenFailed,
          tokenReadFailed: true
        })
      }
    },
    retryTokenRead: async () => {
      const { tokenReadFailed, settings } = get()
      if (!tokenReadFailed || !settings?.serverUrl) return
      try {
        const token = await deps.secret.getItem(TOKEN_KEY)
        const current = get()
        if (!current.tokenReadFailed || !current.settings?.serverUrl) return
        set({
          settings: { serverUrl: current.settings.serverUrl, accessToken: token ?? '' },
          tokenNotice: '',
          tokenReadFailed: false
        })
      } catch {
        // Still unavailable (for example, device locked or missing simulator entitlement); keep existing notice.
      }
    },
    save: async (settings, options) => {
      const serverUrl = settings.serverUrl.trim()
      const accessToken = settings.accessToken.trim()
      try {
        await deps.plain.setItem(SETTINGS_KEY, JSON.stringify({ serverUrl }))
      } catch {
        throw new Error(CONNECTION_STORE_MESSAGES.saveAddressFailed)
      }
      if (!accessToken) {
        if (get().tokenReadFailed && !options?.clearToken) {
          set({ settings: { serverUrl, accessToken: '' } })
          return
        }
        try {
          await deps.secret.deleteItem(TOKEN_KEY)
        } catch {
          // Best-effort clear when no token is configured.
        }
        set({ settings: { serverUrl, accessToken: '' }, tokenNotice: '', tokenReadFailed: false })
        return
      }
      try {
        await deps.secret.setItem(TOKEN_KEY, accessToken)
        set({ settings: { serverUrl, accessToken }, tokenNotice: '', tokenReadFailed: false })
      } catch {
        set({
          settings: { serverUrl, accessToken: '' },
          tokenNotice: CONNECTION_STORE_MESSAGES.saveTokenFailed,
          tokenReadFailed: false
        })
        throw new Error(CONNECTION_STORE_MESSAGES.saveTokenFailed)
      }
    },
    setConnected: connected => set({ connected }),
    setDevice: device => set({ device })
  }))
}
