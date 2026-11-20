import { useCallback, useEffect, useState } from 'react'
import type { Device } from '../../../shared/device-schema'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { useBotStore } from '../bots/bot-store'
import { currentDevice } from './current-device'
import { thisDeviceId } from './this-device'

/** This device as the server knows it, read again after a rename or link (here or in another tab), a change to the
 *  computers (online state, the main mark) and every reconnect. */
export function useThisDevice() {
  const connected = useBotStore(state => state.connected)
  const [device, setDevice] = useState<Device | null>(null)
  const [error, setError] = useState('')

  const run = useCallback(async (request: () => Promise<Device>) => {
    try {
      setDevice(await request())
      setError('')
    } catch (failure) {
      setError(messageOf(failure))
    }
  }, [])

  useEffect(() => {
    if (!connected) return
    const load = () => void run(currentDevice)
    load()
    const stopDevices = lilbot.onDevicesChanged(load)
    const stopComputers = lilbot.onComputersChanged(load)
    return () => {
      stopDevices()
      stopComputers()
    }
  }, [connected, run])

  const rename = (name: string) => run(() => lilbot.call('devices.rename', { deviceId: thisDeviceId(), name }))
  const link = (computer: string | null) => run(() => lilbot.call('devices.linkComputer', { deviceId: thisDeviceId(), computer }))
  return { device, error, rename, link }
}
