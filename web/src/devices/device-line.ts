/** The muted line under "This device": what "my computer" means when written from here. Pure. */
import type { DeviceComputer } from '../../../shared/device-schema'

export function deviceLine(resolves: DeviceComputer): string {
  if (resolves.via === 'none') return 'No main computer yet. From here, bots will ask which computer you mean.'
  if (!resolves.online) return `${resolves.name} is offline. Bots will ask before using another computer.`
  if (resolves.via === 'main') return `When you write "my computer" from here, bots use your main computer, ${resolves.name}.`
  return `When you write "my computer" from here, bots use ${resolves.name}.`
}
