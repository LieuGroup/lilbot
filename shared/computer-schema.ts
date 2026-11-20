import { z } from 'zod'

export const ComputerHello = z.object({
  name: z.string().trim().min(1).max(100),
  os: z.enum(['linux', 'darwin', 'win32', 'freebsd', 'openbsd', 'sunos', 'aix', 'android', 'cygwin', 'netbsd', 'haiku']),
  home: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[^\p{Cc}\p{Cf}]*$/u),
  capabilities: z.array(z.enum(['exec', 'read', 'write', 'list', 'copy'])).max(5)
})
export type ComputerHello = z.infer<typeof ComputerHello>
export interface Computer extends ComputerHello {
  id: string
  online: boolean
  lastSeen: number | null
  keyConflict: boolean
}
export const ComputerOperation = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('exec'),
    command: z.string().min(1).max(100_000),
    cwd: z.string().max(4096).optional(),
    timeoutMs: z.number().int().min(1).max(3_600_000).default(60_000)
  }),
  z.object({ kind: z.literal('read'), path: z.string().min(1).max(4096) }),
  z.object({ kind: z.literal('write'), path: z.string().min(1).max(4096), data: z.string().max(5_600_000), encoding: z.enum(['utf8', 'base64']).default('utf8') }),
  z.object({ kind: z.literal('list'), path: z.string().min(1).max(4096) })
])
export type ComputerOperation = z.infer<typeof ComputerOperation>
export const ComputerSubmit = z.object({
  computer: z.string().min(1),
  requestId: z.string().min(1).max(100),
  operation: ComputerOperation,
  background: z.boolean().default(false)
})
export const ComputerRequestRef = z.object({ computer: z.string().min(1), requestId: z.string().min(1).max(100) })
export const ComputerCopy = ComputerRequestRef.extend({
  direction: z.enum(['toWorkspace', 'fromWorkspace']),
  path: z.string().min(1).max(4096),
  workspacePath: z.string().min(1).max(4096)
})
export const ComputerResult = z.object({
  output: z.string().max(8_000_000).default(''),
  error: z.string().max(1000).optional(),
  exitCode: z.number().nullable().optional()
})
export type ComputerResult = z.infer<typeof ComputerResult>
export interface ComputerRequest {
  id: string
  computer: string
  requestId: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'cancel_acked'
  digest: string
  size: number
  cancelRequested: boolean
  result: ComputerResult | null
  createdAt: number
}
export const HelperFrame = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heartbeat'), challenge: z.string().max(100).optional() }),
  z.object({ type: z.literal('result'), id: z.string(), result: ComputerResult, final: z.boolean().default(true) })
])
export const HelperWork = z.discriminatedUnion('type', [
  z.object({ type: z.literal('work'), id: z.string(), operation: ComputerOperation }),
  z.object({ type: z.literal('cancel'), id: z.string() }),
  z.object({ type: z.literal('heartbeat'), challenge: z.string().max(100).optional() }),
  z.object({ type: z.literal('ack'), id: z.string() }),
  z.object({ type: z.literal('revoked') })
])

/** "Add this computer" from the browser on that computer: what the page says about its own system. */
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
