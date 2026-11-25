/** Browser methods for computers and devices, with attempt status scoped to this browser session. */
import type { Method } from '../../shared/protocol'
import type { AddThisComputer } from '../computers/add-this-computer'
import type { ComputerService } from '../computers/computer-service'
import type { DeviceService } from '../devices/device-service'
import type { Handlers } from './browser-session'

type ComputerMethod = Extract<Method, `computers.${string}` | `devices.${string}`>

export function computerHandlers(
  computers: () => ComputerService,
  addThis: () => AddThisComputer,
  devices: () => DeviceService,
  helperUrl: () => string | undefined,
  sessionId: string,
  onDevice?: (deviceId: string) => void
): Pick<Handlers, ComputerMethod> {
  return {
    'computers.list': async () => computers().list(),
    'computers.installCode': async ({ name }) => ({ ...computers().auth.code(name), helperUrl: helperUrl() }),
    'computers.remove': async ({ computer }) => computers().remove(computer),
    'computers.setMain': async ({ computer }) => devices().main.set(computer),
    'devices.current': async ({ deviceId, name }) => {
      const device = devices().current(deviceId, name)
      onDevice?.(deviceId)
      return device
    },
    'devices.rename': async ({ deviceId, name }) => {
      onDevice?.(deviceId)
      return devices().rename(deviceId, name)
    },
    'devices.linkComputer': async ({ deviceId, computer }) => {
      onDevice?.(deviceId)
      return devices().linkComputer(deviceId, computer)
    },
    'computers.addThis.start': async ({ name, system, deviceId }) => addThis().start(name, system, deviceId, sessionId),
    'computers.addThis.status': async ({ attemptId }) => addThis().status(attemptId, sessionId),
    'computers.downloads': async () => addThis().downloadsInfo(),
    'computers.commandLine.start': async ({ name, system }) => addThis().startCommandLine(name, system, sessionId)
  }
}
