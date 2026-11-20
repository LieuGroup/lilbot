/** "Add this computer" from the browser on that computer. Apart from `computer-schema.ts`, so the web app's
 *  protocol does not load the helper's schemas. */
import { z } from 'zod'
import type { Computer } from './computer-schema'
/** What the page says about its own system. */
export const AddThisSystem = z.object({
  os: z.enum(['macos', 'linux', 'windows', 'ios', 'android', 'chromeos', 'other']),
  arch: z.enum(['arm64', 'x64', 'unknown']).default('unknown')
})
export type AddThisSystem = z.infer<typeof AddThisSystem>
export interface HelperDownload {
  /** Same-origin path that downloads the installer; it carries no secret. */
  url: string
  fileName: string
  os: 'macos' | 'linux'
  /** `universal` runs on every Mac. */
  arch: 'universal' | 'arm64' | 'x64'
  signed: boolean
  /** Whether the build answers `lilbot-helper://` links. */
  link: boolean
  size: number
  version: string
}
export type AddThisStart =
  | {
      supported: true
      attemptId: string
      expiresAt: number
      /** The short one-time line: posted to `handoverUrl`, put in `link`, or pasted into the installer. */
      code: string
      /** POST `{ code }` here as JSON; poll GET `<handoverUrl>/v1/hello` to see the helper is open. */
      handoverUrl: string
      link: string
      /** Best match first. */
      downloads: HelperDownload[]
    }
  /** `system`: this device cannot run the helper. `unavailable`: no installer is built for this LilBot yet. */
  | { supported: false; reason: 'system' | 'unavailable' }
export interface AddThisStatus {
  /** `registered`: the helper registered and is starting; `connected`: it is online. */
  state: 'waiting' | 'registered' | 'connected' | 'expired'
  expiresAt: number
  computer?: Computer
}
