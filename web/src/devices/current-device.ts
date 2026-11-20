/** Tells the server about this device (it makes the record on first sight) and returns what it knows. */
import { lilbot } from '../app/lilbot-socket'
import { browserFacts } from '../computers/add-this-system'
import { deviceNameOf } from './device-name'
import { thisDeviceId } from './this-device'

/** The name is used only the first time; afterwards the server keeps the one Oscar gave. */
export const currentDevice = () => lilbot.call('devices.current', { deviceId: thisDeviceId(), name: deviceNameOf(browserFacts()) })

/** On every connection, so a message sent from here is never from an unknown device. */
export function registerDevice() {
  currentDevice().catch(error => console.warn('LilBot: could not register this device', error instanceof Error ? error.message : error))
}
