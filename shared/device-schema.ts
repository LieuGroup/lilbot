/** Devices: one record per browser or app install, and where a chat message came from. */
import { z } from 'zod'

export const DeviceId = z.string().uuid()
/** Shown to Oscar and told to bots, so no control or invisible formatting characters (same rule as a computer's home). */
export const DeviceName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*$/u, 'A device name cannot contain control or hidden characters.')

/** What a stored user message says about where it was sent from: the name is the one at send time. */
export const MessageOrigin = z.object({ deviceId: z.string(), name: z.string() })
export type MessageOrigin = z.infer<typeof MessageOrigin>

/** What "my computer" means from a device: its own computer, else the main one, else nothing. */
export type DeviceComputer = { via: 'linked' | 'main'; computerId: string; name: string; online: boolean } | { via: 'none' }

export interface Device {
  id: string
  name: string
  /** The computer this device runs on. Null when none is set or that computer was removed. */
  computerId: string | null
  resolves: DeviceComputer
}
