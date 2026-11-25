/** Starting the LilBot socket and registering this install as a device. Kept out of the settings
 *  store so `connection/store` never imports `connection/lilbot` back (a require cycle). */
import Constants from 'expo-constants'
import { thisDeviceId } from '../devices/device'
import { ensureSocket, stopSocket } from './lilbot'
import { useConnectionStore } from './store'

/** Stops any running socket immediately so disconnecting drops the old server session and token. */
export function stopConnection() {
  stopSocket()
}

/** This install's name as the server first sees it: the device's own name. */
function deviceName(): string {
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
async function registerDevice() {
  const socket = ensureSocket()
  if (!socket) return
  try {
    const device = await socket.call('devices.current', { deviceId: await thisDeviceId(), name: deviceName() })
    useConnectionStore.getState().setDevice(device)
  } catch (error) {
    console.warn('LilBot: could not register this device', error instanceof Error ? error.message : error)
  }
}
