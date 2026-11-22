/** The server settings this install uses, plus the live connection state. The Access token
 *  lives in the Keychain (expo-secure-store); only the server address is plain storage. */
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import * as SecureStore from 'expo-secure-store'
import { create } from 'zustand'
import type { Device } from '../../../shared/device-schema'
import { thisDeviceId } from '../devices/device'
import { ensureSocket, resetSocket } from './lilbot'

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
    resetSocket()
    await Promise.all([AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ serverUrl: settings.serverUrl })), SecureStore.setItemAsync(TOKEN_KEY, settings.accessToken)])
    set({ settings })
  },
  setConnected: connected => set({ connected }),
  setDevice: device => set({ device })
}))

/** This install's name as the server first sees it: the device's own name. */
export function deviceName(): string {
  return Constants.deviceName ?? 'iPhone'
}

/** Start the socket once; after every (re)connect make sure the server knows this device. The
 *  roster and chats listen to push events themselves. */
export function startConnection() {
  const socket = ensureSocket()
  if (!socket) return
  socket.onConnection(connected => {
    useConnectionStore.getState().setConnected(connected)
    if (!connected) return
    void registerDevice()
  })
  socket.connect()
}

/** Tell the server about this device, so a message sent from here is never from an unknown device. */
export async function registerDevice() {
  const socket = ensureSocket()
  if (!socket) return
  try {
    const device = await socket.call('devices.current', { deviceId: await thisDeviceId(), name: deviceName() })
    useConnectionStore.getState().setDevice(device)
  } catch (error) {
    console.warn('LilBot: could not register this device', error instanceof Error ? error.message : error)
  }
}
