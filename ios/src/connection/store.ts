/** The server settings this install uses, kept on the device, plus the live connection state. */
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import { create } from 'zustand'
import type { Device } from '../../../shared/device-schema'
import { thisDeviceId } from '../devices/device'
import { ensureSocket, resetSocket } from './lilbot'

const KEY = 'lilbot.settings'

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

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  settings: null,
  loaded: false,
  connected: false,
  device: null,
  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY)
      set({ settings: raw ? (JSON.parse(raw) as ServerSettings) : null, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },
  save: async settings => {
    resetSocket()
    await AsyncStorage.setItem(KEY, JSON.stringify(settings))
    set({ settings })
  },
  setConnected: connected => set({ connected }),
  setDevice: device => set({ device })
}))

/** This install's name as the server first sees it: the device's own name. */
export function deviceName(): string {
  return Constants.deviceName ?? 'iPhone'
}

/** Start the socket once; after every (re)connect reload nothing here — the roster and chats
 *  listen themselves — and make sure the server knows this device. */
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
