/** Shared boundary constants and exact display/copy allow-lists for the engine and helper-driver guard. */
import type { NameScanAllowlist } from './boundary-scanner'

export const SERVER_REGISTRATION_POINTS = ['server/engines/registry.ts', 'server/engines/metadata.ts'] as const
export const HELPER_REGISTRATION_POINT = 'helper/drivers/registry.ts'
export const LEADER_DRIVER_DECLARATION = 'server/computers/remote-worker-drivers.ts'
export const SCANNED_ROOTS = ['server', 'shared', 'web', 'ios', 'helper'] as const

/** Exact UI display-label entries and documented user-facing example copy strings (never whole-file exemptions).
 *  Bot-facing guides/skills live in Markdown (`.md`), which is prose outside this TS/JS code guard. */
export const NAME_ALLOWLIST: Record<string, NameScanAllowlist> = {
  'web/src/computers/coding-engines.ts': {
    labels: [
      { table: 'ENGINE_NAMES', key: 'hermes', label: 'Hermes' },
      { table: 'ENGINE_NAMES', key: 'claude-code', label: 'Claude Code' },
      { table: 'ENGINE_NAMES', key: 'codex', label: 'Codex' }
    ]
  },
  'web/src/computers/coding-worker-status.tsx': {
    copy: [
      '. Install a supported coding engine (for example, Claude Code) and sign in there. LilBot checks again every 5 minutes.',
      'No coding engine found on this computer. Install a coding engine (for example, Claude Code) and sign in there. LilBot checks again every 5 minutes.'
    ]
  },
  'web/src/computers/command-line-setup.tsx': {
    copy: ['To run coding workers on this computer, install a coding engine on it (for example, Claude Code) and sign in there. Files and terminal work without it.']
  }
}

export function isNameExempt(file: string, engines: readonly string[], drivers: readonly string[]): boolean {
  if ((SERVER_REGISTRATION_POINTS as readonly string[]).includes(file) || file === HELPER_REGISTRATION_POINT || file === LEADER_DRIVER_DECLARATION) return true
  return engines.some(id => file.startsWith(`server/engines/${id}/`)) || drivers.some(id => file.startsWith(`helper/drivers/${id}/`))
}
