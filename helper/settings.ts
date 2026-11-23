/** Settings baked into a downloadable helper at build time: which LilBot it belongs to. Public, never secret.
 *  A helper built without them (`bun run build:helper`) only supports the command-line install. */
import { createHash } from 'node:crypto'
import { z } from 'zod'

declare const LILBOT_HELPER_SETTINGS: string | undefined

export const HELPER_VERSION = '2'
/** The loopback port a freshly opened helper listens on for the page's hand-over. */
export const HANDOVER_PORT = 47613
export const HelperSettings = z.object({
  /** The helper door's origin: where the helper registers and connects. */
  door: z.string().url(),
  /** Exact origins of LilBot's own pages that may hand a code to the helper. */
  origins: z.array(z.string().url()).min(1).max(20),
  port: z.number().int().min(1).max(65535),
  /** SHA-256 of the server key, completing the short code the page hands over. */
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/)
})
export type HelperSettings = z.infer<typeof HelperSettings>
export const settingsJson = (settings: HelperSettings) => JSON.stringify(HelperSettings.parse(settings))
export const settingsHash = (settings: HelperSettings) => createHash('sha256').update(settingsJson(settings)).digest('hex')
export const bakedSettings: HelperSettings | null = typeof LILBOT_HELPER_SETTINGS === 'string' ? HelperSettings.parse(JSON.parse(LILBOT_HELPER_SETTINGS)) : null
/** The page hands over only the random part; the fingerprint comes from the build. */
export const SHORT_CODE = /^[A-Za-z0-9_-]{32}$/
/** Full command-line install code: random token plus 64-hex server key fingerprint. */
export const INSTALL_CODE = /^[A-Za-z0-9_-]{32}\.[a-f0-9]{64}$/

/** A downloaded build belongs to one LilBot: its command-line install registers only at the baked door. */
export function assertBakedDoor(url: string, baked: HelperSettings | null) {
  if (baked && new URL(url).origin !== new URL(baked.door).origin) throw new Error('This helper only registers with its own LilBot.')
}
