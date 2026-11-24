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

export interface ConnectionState {
  settings: ServerSettings | null
  loaded: boolean
  connected: boolean
  device: Device | null
  tokenNotice: string
  load: () => Promise<void>
  save: (settings: ServerSettings) => Promise<void>
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
  return create<ConnectionState>(set => ({
    settings: null,
    loaded: false,
    connected: false,
    device: null,
    tokenNotice: '',
    load: async () => {
      let serverUrl: string | null = null
      try {
        serverUrl = parseSavedAddress(await deps.plain.getItem(SETTINGS_KEY))
      } catch {
        set({ loaded: true })
        return
      }
      if (!serverUrl) {
        set({ settings: null, loaded: true, tokenNotice: '' })
        return
      }
      try {
        const token = await deps.secret.getItem(TOKEN_KEY)
        set({ settings: { serverUrl, accessToken: token ?? '' }, loaded: true, tokenNotice: '' })
      } catch {
        set({ settings: { serverUrl, accessToken: '' }, loaded: true, tokenNotice: CONNECTION_STORE_MESSAGES.readTokenFailed })
      }
    },
    save: async settings => {
      const serverUrl = settings.serverUrl.trim()
      const accessToken = settings.accessToken.trim()
      try {
        await deps.plain.setItem(SETTINGS_KEY, JSON.stringify({ serverUrl }))
      } catch {
        throw new Error(CONNECTION_STORE_MESSAGES.saveAddressFailed)
      }
      if (!accessToken) {
        try {
          await deps.secret.deleteItem(TOKEN_KEY)
        } catch {
          // Best-effort clear when no token is configured.
        }
        set({ settings: { serverUrl, accessToken: '' }, tokenNotice: '' })
        return
      }
      try {
        await deps.secret.setItem(TOKEN_KEY, accessToken)
        set({ settings: { serverUrl, accessToken }, tokenNotice: '' })
      } catch {
        set({ settings: { serverUrl, accessToken: '' }, tokenNotice: CONNECTION_STORE_MESSAGES.saveTokenFailed })
        throw new Error(CONNECTION_STORE_MESSAGES.saveTokenFailed)
      }
    },
    setConnected: connected => set({ connected }),
    setDevice: device => set({ device })
  }))
}
