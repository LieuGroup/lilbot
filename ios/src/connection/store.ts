/** The server settings this install uses, plus the live connection state. The Access token
 *  lives in the Keychain (expo-secure-store); only the server address is plain storage. */
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { create } from 'zustand'
import type { Device } from '../../../shared/device-schema'

const SETTINGS_KEY = 'lilbot.settings'
const TOKEN_KEY = 'lilbot.accessToken'

export interface ServerSettings {
  serverUrl: string
  accessToken: string
}

interface ConnectionState {
  settings: ServerSettings | null
  loaded: boolean
  connected: boolean
  device: Device | null
  load: () => Promise<void>
  save: (settings: ServerSettings) => Promise<void>
  setConnected: (connected: boolean) => void
  setDevice: (device: Device) => void
}

export const useConnectionStore = create<ConnectionState>(set => ({
  settings: null,
  loaded: false,
  connected: false,
  device: null,
  load: async () => {
    try {
      const [raw, token] = await Promise.all([AsyncStorage.getItem(SETTINGS_KEY), SecureStore.getItemAsync(TOKEN_KEY)])
      const saved = raw ? (JSON.parse(raw) as { serverUrl: string }) : null
      set({ settings: saved ? { serverUrl: saved.serverUrl, accessToken: token ?? '' } : null, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },
  save: async settings => {
    await Promise.all([AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ serverUrl: settings.serverUrl })), SecureStore.setItemAsync(TOKEN_KEY, settings.accessToken)])
    set({ settings })
  },
  setConnected: connected => set({ connected }),
  setDevice: device => set({ device })
}))
