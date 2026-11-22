/** Strict CLI argument parsing and summary formatting for `bun run bot:rekey`. Zero production defaults. */
import type { DiskReport, FailurePoint } from './rekey-disk'
import type { ServiceProbeResult } from './rekey-guard'
import type { UndoFailurePoint } from './rekey-undo'

export interface RekeyOptions {
  from: string
  to?: string
  dataDir: string
  workspacesDir: string | null
  hermesHome: string | null
  clearMainChat: boolean
  dryRun: boolean
  testHooks?: { injectFailure?: FailurePoint; simulateCrash?: boolean; minDataBytes?: number; serviceProbe?: () => ServiceProbeResult }
}

export interface UndoOptions {
  undo: string
  dryRun: boolean
  force?: boolean
  testHooks?: { serviceProbe?: () => ServiceProbeResult; injectFailure?: UndoFailurePoint }
}

export interface RekeySummary {
  mode: 'dry-run' | 'applied' | 'already-rekeyed'
  from: string
  to: string
  engineBotId: string
  backupDir?: string
  tableCounts: Record<string, number>
  totalChanges: number
  clearedMainChat: boolean
  disk: DiskReport
  kept: Record<string, number>
  durationMs: number
}

const USAGE =
  'Usage: bun run bot:rekey -- --from <oldId> --data-dir <dir> (--workspaces-dir <dir> | --skip-workspaces) (--hermes-home <dir> | --skip-hermes) [--to <newId>] [--clear-main-chat] [--dry-run] [--yes]\n' +
  '   or: bun run bot:rekey -- --undo <backupDir> [--dry-run] [--yes] [--force]'

const VALUE_FLAGS = new Set(['--from', '--to', '--data-dir', '--workspaces-dir', '--hermes-home', '--undo'])
const BOOL_FLAGS = new Set(['--clear-main-chat', '--dry-run', '--yes', '--skip-workspaces', '--skip-hermes', '--force'])

export function parseCli(argv: string[]): RekeyOptions | UndoOptions {
  const values = new Map<string, string>()
  const flags = new Set<string>()
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (VALUE_FLAGS.has(token)) {
      const next = argv[i + 1]
      if (!next || next.startsWith('-')) throw new Error(`Missing value for ${token}.\n${USAGE}`)
      values.set(token, next)
      i++
    } else if (BOOL_FLAGS.has(token)) {
      flags.add(token)
    } else {
      throw new Error(`Unknown argument: ${token}\n${USAGE}`)
    }
  }
  const dryRun = flags.has('--dry-run') || !flags.has('--yes')
  const undo = values.get('--undo')
  if (undo) {
    if (values.size > 1 || flags.has('--clear-main-chat') || flags.has('--skip-workspaces') || flags.has('--skip-hermes'))
      throw new Error(`--undo cannot be combined with re-key flags.\n${USAGE}`)
    return { undo, dryRun, force: flags.has('--force') }
  }
  if (flags.has('--force')) throw new Error(`--force is only valid with --undo.\n${USAGE}`)
  const from = values.get('--from')
  const dataDir = values.get('--data-dir')
  const workspacesDir = values.get('--workspaces-dir') ?? null
  const hermesHome = values.get('--hermes-home') ?? null
  if (!from || !dataDir) throw new Error(`--from and --data-dir are required (no production defaults).\n${USAGE}`)
  if (!workspacesDir && !flags.has('--skip-workspaces')) throw new Error(`Pass --workspaces-dir <dir> or explicitly --skip-workspaces.\n${USAGE}`)
  if (workspacesDir && flags.has('--skip-workspaces')) throw new Error(`Pass either --workspaces-dir or --skip-workspaces, not both.\n${USAGE}`)
  if (!hermesHome && !flags.has('--skip-hermes')) throw new Error(`Pass --hermes-home <dir> or explicitly --skip-hermes.\n${USAGE}`)
  if (hermesHome && flags.has('--skip-hermes')) throw new Error(`Pass either --hermes-home or --skip-hermes, not both.\n${USAGE}`)
  return { from, to: values.get('--to'), dataDir, workspacesDir, hermesHome, clearMainChat: flags.has('--clear-main-chat'), dryRun }
}

export function printSummary(summary: RekeySummary) {
  console.log(`Mode: ${summary.mode}`)
  console.log(`From: ${summary.from} -> To: ${summary.to} (engine_bot_id kept: ${summary.engineBotId})`)
  if (summary.backupDir) console.log(`Backup: ${summary.backupDir}`)
  console.log(`Database updates (${summary.totalChanges} total):`)
  const entries = Object.entries(summary.tableCounts).sort(([a], [b]) => a.localeCompare(b))
  if (!entries.length) console.log('  (none)')
  for (const [table, count] of entries) console.log(`  ${table}: ${count}`)
  console.log(`Main chat cleared: ${summary.clearedMainChat ? 'yes' : 'no'}`)
  console.log(`Workspace: ${summary.disk.workspace} | Archive: ${summary.disk.archive}`)
  console.log(
    `Hermes profile: ${
      Object.entries(summary.disk.hermes)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ') || 'skipped'
    }`
  )
  console.log(
    `Kept intact: ${Object.entries(summary.kept)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')}`
  )
  console.log(`Duration: ${summary.durationMs}ms`)
  if (summary.mode === 'dry-run') console.log('Dry run complete. Re-run with --yes (without --dry-run) to apply.')
}
