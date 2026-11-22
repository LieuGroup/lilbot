/** `bun run bot:rekey -- --from <oldId> [--to <newId>] [--data-dir <dir>] [--workspaces-dir <dir>] [--hermes-home <dir>] [--clear-main-chat] [--dry-run] [--yes]`
 *  One-time operator tool that re-keys a LilBot bot id across SQLite, workspace folders, and Hermes profile settings.
 *  Defaults to dry run unless `--yes` is passed (`--dry-run` overrides `--yes`). Prints counts, table names, and disk actions only. */
import { Database } from 'bun:sqlite'
import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { verifyDatabaseRekey } from './rekey/rekey-check'
import { applyDatabaseRekey, inspectBotState, previewDatabaseRekey } from './rekey/rekey-db'
import { applyDiskRekey, type DiskReport, preflightWorkspace, verifyDiskRekey } from './rekey/rekey-disk'
import { assertDatabaseNotInUse, backupForRollback, restoreFromBackup } from './rekey/rekey-guard'

const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/

export interface RekeyOptions {
  from: string
  to?: string
  dataDir: string
  workspacesDir: string
  hermesHome: string
  clearMainChat: boolean
  dryRun: boolean
}

export interface RekeySummary {
  mode: 'dry-run' | 'applied' | 'already-rekeyed'
  from: string
  to: string
  engineBotId: string
  tableCounts: Record<string, number>
  totalChanges: number
  clearedMainChat: boolean
  disk: DiskReport
  kept: Record<string, number>
  durationMs: number
}

function inspectState(dbPath: string, from: string, to?: string) {
  const db = new Database(dbPath, { readonly: true, strict: true })
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    return inspectBotState(db, from, to)
  } finally {
    db.close()
  }
}

export function runRekey(options: RekeyOptions): RekeySummary {
  const started = performance.now()
  if (!SAFE_ID.test(options.from)) throw new Error(`Invalid --from bot id: ${options.from}`)
  if (options.to !== undefined && (!SAFE_ID.test(options.to) || options.to === options.from)) throw new Error(`Invalid --to bot id: ${options.to}`)
  const dbPath = join(options.dataDir, 'lilbot.db')
  if (!existsSync(dbPath)) throw new Error(`No LilBot database at ${dbPath}.`)
  if (!options.dryRun) assertDatabaseNotInUse(options.dataDir)

  const state = inspectState(dbPath, options.from, options.to)
  if (state.status === 'missing') throw new Error(`Bot "${options.from}" not found in bots table.`)
  if (state.status === 'collision') throw new Error(`Target bot id "${options.to}" already exists in bots table.`)
  const engineBotId = state.engineBotId!
  const targetId = state.status === 'already_rekeyed' ? state.existingNewId! : (options.to ?? crypto.randomUUID())
  const done = (
    mode: RekeySummary['mode'],
    tableCounts: Record<string, number>,
    totalChanges: number,
    clearedMainChat: boolean,
    disk: DiskReport,
    kept: Record<string, number>
  ) => ({
    mode,
    from: options.from,
    to: targetId,
    engineBotId,
    tableCounts,
    totalChanges,
    clearedMainChat,
    disk,
    kept,
    durationMs: Math.round(performance.now() - started)
  })

  if (state.status === 'already_rekeyed') {
    const checkDb = new Database(dbPath, { readonly: true, strict: true })
    const check = (() => {
      try {
        return verifyDatabaseRekey(checkDb, options.from, targetId, engineBotId)
      } finally {
        checkDb.close()
      }
    })()
    if (!check.ok) throw new Error(`Database is in a partial state:\n${check.failures.join('\n')}`)
    const disk = applyDiskRekey(options.workspacesDir, options.hermesHome, engineBotId, options.dataDir, options.from, targetId, options.dryRun)
    if (!options.dryRun) {
      const diskFailures = verifyDiskRekey(options.workspacesDir, options.hermesHome, engineBotId, options.dataDir, options.from, targetId)
      if (diskFailures.length) throw new Error(`Disk self-check failed:\n${diskFailures.join('\n')}`)
    }
    return done('already-rekeyed', {}, 0, false, disk, check.kept)
  }

  if (options.dryRun) {
    const db = new Database(dbPath, { readonly: true, strict: true })
    try {
      db.exec('PRAGMA busy_timeout = 5000')
      const preview = previewDatabaseRekey(db, options.from, targetId)
      const disk = applyDiskRekey(options.workspacesDir, options.hermesHome, engineBotId, options.dataDir, options.from, targetId, true)
      return done('dry-run', preview.perTable, preview.totalChanges, options.clearMainChat && preview.hasMainChat, disk, { 'bots.engine_bot_id': 1 })
    } finally {
      db.close()
    }
  }

  preflightWorkspace(options.workspacesDir, options.from, targetId)
  const rollbackBackup = join(options.dataDir, `.rekey-rollback-${process.pid}.db`)
  let dbResult: ReturnType<typeof applyDatabaseRekey>
  const db = new Database(dbPath, { create: false, strict: true })
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    backupForRollback(db, rollbackBackup)
    dbResult = applyDatabaseRekey(db, options.from, targetId, engineBotId, options.clearMainChat)
  } catch (error) {
    rmSync(rollbackBackup, { force: true })
    throw error
  } finally {
    db.close()
  }

  let disk: DiskReport
  try {
    disk = applyDiskRekey(options.workspacesDir, options.hermesHome, engineBotId, options.dataDir, options.from, targetId, false)
  } catch (error) {
    restoreFromBackup(rollbackBackup, dbPath)
    throw new Error(`Disk step failed (database restored from pre-run snapshot): ${error instanceof Error ? error.message : String(error)}`)
  }
  rmSync(rollbackBackup, { force: true })
  const diskFailures = verifyDiskRekey(options.workspacesDir, options.hermesHome, engineBotId, options.dataDir, options.from, targetId)
  if (diskFailures.length) throw new Error(`Disk self-check failed:\n${diskFailures.join('\n')}`)
  return done('applied', dbResult.tableCounts, dbResult.totalChanges, dbResult.clearedMainChat, disk, dbResult.kept)
}

function parseCli(argv: string[]): RekeyOptions {
  const arg = (name: string) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const from = arg('--from')
  if (!from) {
    throw new Error(
      'Usage: bun run bot:rekey -- --from <oldId> [--to <newId>] [--data-dir <dir>] [--workspaces-dir <dir>] [--hermes-home <dir>] [--clear-main-chat] [--dry-run] [--yes]'
    )
  }
  return {
    from,
    to: arg('--to'),
    dataDir: arg('--data-dir') ?? process.env.LILBOT_DATA_DIR ?? join(homedir(), '.local', 'share', 'lilbot'),
    workspacesDir: arg('--workspaces-dir') ?? process.env.LILBOT_WORKSPACES_DIR ?? join(homedir(), 'lilbot', 'workspaces'),
    hermesHome: arg('--hermes-home') ?? process.env.HERMES_HOME ?? join(homedir(), '.hermes'),
    clearMainChat: argv.includes('--clear-main-chat'),
    dryRun: argv.includes('--dry-run') || !argv.includes('--yes')
  }
}

function printSummary(summary: RekeySummary) {
  console.log(`Mode: ${summary.mode}`)
  console.log(`From: ${summary.from} -> To: ${summary.to} (engine_bot_id kept: ${summary.engineBotId})`)
  console.log(`Database updates (${summary.totalChanges} total):`)
  const entries = Object.entries(summary.tableCounts).sort(([a], [b]) => a.localeCompare(b))
  if (!entries.length) console.log('  (none)')
  for (const [table, count] of entries) console.log(`  ${table}: ${count}`)
  console.log(`Main chat cleared: ${summary.clearedMainChat ? 'yes' : 'no'}`)
  console.log(`Workspace: ${summary.disk.workspace} | Archive: ${summary.disk.archive}`)
  console.log(
    `Hermes profile: ${Object.entries(summary.disk.hermes)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')}`
  )
  console.log(
    `Kept intact: ${Object.entries(summary.kept)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')}`
  )
  console.log(`Duration: ${summary.durationMs}ms`)
  if (summary.mode === 'dry-run') console.log('Dry run complete. Re-run with --yes (without --dry-run) to apply.')
}

if (import.meta.main) {
  try {
    printSummary(runRekey(parseCli(process.argv.slice(2))))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
