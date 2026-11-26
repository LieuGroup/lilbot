/** This install's server device record (name + linked computer), kept live across `devices.changed`. */
import { useCallback, useEffect, useState } from 'react'
import { Platform } from 'react-native'
import type { Device } from '../../../shared/device-schema'
import { messageOf } from '../../../shared/client/socket'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'
import { thisDeviceId } from './device'

function defaultDeviceName(): string {
  return Platform.OS === 'ios' ? 'iPhone' : 'Mobile device'
}

export function useThisDevice() {
  const connected = useConnectionStore(state => state.connected)
  const storedDevice = useConnectionStore(state => state.device)
  const setStoredDevice = useConnectionStore(state => state.setDevice)
  const [device, setDevice] = useState<Device | null>(storedDevice)
  const [error, setError] = useState('')

  useEffect(() => {
    if (storedDevice) setDevice(storedDevice)
  }, [storedDevice])

  const load = useCallback(async () => {
    const socket = ensureSocket()
    if (!socket || !connected) return
    try {
      const deviceId = await thisDeviceId()
      const current = await socket.call('devices.current', { deviceId, name: defaultDeviceName() })
      setDevice(current)
      setStoredDevice(current)
      setError('')
    } catch (failure) {
      setError(messageOf(failure))
    }
  }, [connected, setStoredDevice])

  useEffect(() => {
    void load()
    const socket = ensureSocket()
    if (!socket) return
    const offDevices = socket.onDevicesChanged(() => void load())
    const offComputers = socket.onComputersChanged(() => void load())
    return () => {
      offDevices()
      offComputers()
    }
  }, [load])

  const rename = useCallback(
    async (name: string) => {
      const socket = ensureSocket()
      if (!socket) return
      setError('')
      try {
        const deviceId = await thisDeviceId()
        const updated = await socket.call('devices.rename', { deviceId, name: name.trim() })
        setDevice(updated)
        setStoredDevice(updated)
      } catch (failure) {
        setError(messageOf(failure))
      }
    },
    [setStoredDevice]
  )

  const link = useCallback(
    async (computer: string | null) => {
      const socket = ensureSocket()
      if (!socket) return
      setError('')
      try {
        const deviceId = await thisDeviceId()
        const updated = await socket.call('devices.linkComputer', { deviceId, computer })
        setDevice(updated)
        setStoredDevice(updated)
      } catch (failure) {
        setError(messageOf(failure))
      }
    },
    [setStoredDevice]
  )

  return { device, error, rename, link }
}
