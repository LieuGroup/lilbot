/** One-time operator CLI to re-key a LilBot bot id (or undo from backup). Requires explicit paths (no production defaults),
 *  refuses unknown flags, live service/locks, deleted bots, and in-flight work. Defaults to dry run unless `--yes` is passed. */
import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createRekeyBackup, readManifest, restoreRekeyBackup } from './rekey/rekey-backup'
import { verifyDatabaseRekey } from './rekey/rekey-check'
import { parseCli, printSummary, type RekeyOptions, type RekeySummary, type UndoOptions } from './rekey/rekey-cli'
import { applyDatabaseRekey, inspectBotState, previewDatabaseRekey } from './rekey/rekey-db'
import { applyDiskRekey, type DiskReport, verifyDiskRekey } from './rekey/rekey-disk'
import { assertDatabaseNotInUse } from './rekey/rekey-guard'
import { type RekeyJournal, readJournal, removeJournal, writeJournal } from './rekey/rekey-journal'
import { preflightDisk } from './rekey/rekey-preflight'
import { inFlightCounts } from './rekey/rekey-targets'

export type { RekeyOptions, RekeySummary, UndoOptions }

const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/

function withReadonlyDb<T>(dbPath: string, run: (db: Database) => T): T {
  const db = new Database(dbPath, { readonly: true, strict: true })
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    return run(db)
  } finally {
    db.close()
  }
}

export async function runUndo(options: UndoOptions) {
  const manifest = readManifest(options.undo)
  if (!options.dryRun) assertDatabaseNotInUse(manifest.dataDir, options.testHooks?.serviceProbe)
  return restoreRekeyBackup(options.undo, options.dryRun)
}

export async function runRekey(options: RekeyOptions): Promise<RekeySummary> {
  const started = performance.now()
  if (!SAFE_ID.test(options.from)) throw new Error(`Invalid --from bot id: ${options.from}`)
  if (options.to !== undefined && (!SAFE_ID.test(options.to) || options.to === options.from)) throw new Error(`Invalid --to bot id: ${options.to}`)
  const dbPath = join(options.dataDir, 'lilbot.db')
  if (!existsSync(dbPath)) throw new Error(`No LilBot database at ${dbPath}.`)
  if (!options.dryRun) assertDatabaseNotInUse(options.dataDir, options.testHooks?.serviceProbe)

  const existingJournal = readJournal(options.dataDir)
  if (existingJournal) {
    if (existingJournal.from !== options.from)
      throw new Error(`Unfinished rekey journal found for "${existingJournal.from}" -> "${existingJournal.to}"; resume or --undo ${existingJournal.backupDir} first.`)
    if (options.to !== undefined && options.to !== existingJournal.to)
      throw new Error(`Unfinished rekey journal pins target id "${existingJournal.to}" (got --to "${options.to}").`)
  }

  const requestedTo = options.to ?? existingJournal?.to
  const state = withReadonlyDb(dbPath, db => inspectBotState(db, options.from, requestedTo, existingJournal ? { from: existingJournal.from, to: existingJournal.to } : undefined))
  if (state.status === 'deleted') throw new Error(`Refusing to re-key deleted (tombstoned) bot "${options.from}".`)
  if (state.status === 'missing') throw new Error(`Bot "${options.from}" not found in bots table.`)
  if (state.status === 'collision') throw new Error(`Target bot id "${requestedTo}" already exists in bots table.`)
  if (state.status === 'wrong_target')
    throw new Error(`Bot "${options.from}" not found, and target "${requestedTo}" belongs to a different bot (engine_bot_id="${state.engineBotId}").`)

  const engineBotId = state.engineBotId!
  const targetId = state.status === 'already_rekeyed' ? state.existingNewId! : (requestedTo ?? crypto.randomUUID())

  if (state.status === 'ready') {
    const active = Object.entries(withReadonlyDb(dbPath, db => inFlightCounts(db, options.from)))
    if (active.length) throw new Error(`Refusing to re-key while work is in flight: ${active.map(([k, n]) => `${k}=${n}`).join(', ')}. Wait for it to settle first.`)
  }

  preflightDisk({
    dataDir: options.dataDir,
    workspacesDir: options.workspacesDir,
    hermesHome: options.hermesHome,
    engineBotId,
    oldId: options.from,
    newId: targetId,
    minDataBytes: options.testHooks?.minDataBytes
  })

  const done = (
    mode: RekeySummary['mode'],
    tableCounts: Record<string, number>,
    totalChanges: number,
    clearedMainChat: boolean,
    disk: DiskReport,
    kept: Record<string, number>,
    backupDir?: string
  ): RekeySummary => ({
    mode,
    from: options.from,
    to: targetId,
    engineBotId,
    ...(backupDir ? { backupDir } : {}),
    tableCounts,
    totalChanges,
    clearedMainChat,
    disk,
    kept,
    durationMs: Math.round(performance.now() - started)
  })

  const diskArgs = { workspacesDir: options.workspacesDir, hermesHome: options.hermesHome, engineBotId, dataDir: options.dataDir, oldId: options.from, newId: targetId }

  if (state.status === 'already_rekeyed') {
    const dbCheck = withReadonlyDb(dbPath, db => verifyDatabaseRekey(db, options.from, targetId, engineBotId))
    if (!dbCheck.ok) throw new Error(`Database self-check failed for already-rekeyed bot:\n${dbCheck.failures.join('\n')}`)
    const disk = applyDiskRekey({ ...diskArgs, dryRun: options.dryRun, injectFailure: options.testHooks?.injectFailure })
    if (!options.dryRun) {
      const diskFailures = verifyDiskRekey(options.workspacesDir, options.hermesHome, engineBotId, options.dataDir, options.from, targetId)
      if (diskFailures.length) throw new Error(`Disk self-check failed:\n${diskFailures.join('\n')}`)
      if (existingJournal) removeJournal(options.dataDir)
    }
    return done(options.dryRun ? 'dry-run' : 'already-rekeyed', {}, 0, false, disk, dbCheck.kept, existingJournal?.backupDir)
  }

  if (options.dryRun) {
    const preview = withReadonlyDb(dbPath, db => previewDatabaseRekey(db, options.from, targetId))
    const disk = applyDiskRekey({ ...diskArgs, dryRun: true })
    return done('dry-run', preview.perTable, preview.totalChanges, options.clearMainChat && preview.hasMainChat, disk, { 'bots.engine_bot_id': 1 })
  }

  const backupDir =
    existingJournal?.steps.backup && existsSync(existingJournal.backupDir)
      ? existingJournal.backupDir
      : await createRekeyBackup({ dataDir: options.dataDir, workspacesDir: options.workspacesDir, hermesHome: options.hermesHome, from: options.from, to: targetId, engineBotId })
  const journal: RekeyJournal = existingJournal ?? {
    version: 1,
    from: options.from,
    to: targetId,
    engineBotId,
    backupDir,
    dataDir: options.dataDir,
    workspacesDir: options.workspacesDir,
    hermesHome: options.hermesHome,
    clearMainChat: options.clearMainChat,
    steps: { backup: true, db: false, workspace: false, archive: false, hermes: false }
  }
  writeJournal(options.dataDir, journal)

  const db = new Database(dbPath, { strict: true })
  let dbResult: ReturnType<typeof applyDatabaseRekey>
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    dbResult = applyDatabaseRekey(db, options.from, targetId, engineBotId, options.clearMainChat)
  } catch (error) {
    removeJournal(options.dataDir)
    throw error
  } finally {
    db.close()
  }
  journal.steps.db = true
  writeJournal(options.dataDir, journal)

  let disk: DiskReport
  try {
    if (options.testHooks?.injectFailure === 'post-db') throw new Error('Injected failure at post-db')
    disk = applyDiskRekey({
      ...diskArgs,
      dryRun: false,
      injectFailure: options.testHooks?.injectFailure,
      onStep: step => {
        journal.steps[step] = true
        writeJournal(options.dataDir, journal)
      }
    })
    const diskFailures = verifyDiskRekey(options.workspacesDir, options.hermesHome, engineBotId, options.dataDir, options.from, targetId)
    if (diskFailures.length) throw new Error(`Disk self-check failed:\n${diskFailures.join('\n')}`)
  } catch (error) {
    if (options.testHooks?.simulateCrash) throw error
    await restoreRekeyBackup(backupDir, false)
    throw new Error(`Post-DB step failed (fully rolled back from backup ${backupDir}): ${error instanceof Error ? error.message : String(error)}`)
  }
  removeJournal(options.dataDir)
  return done('applied', dbResult.tableCounts, dbResult.totalChanges, dbResult.clearedMainChat, disk, dbResult.kept, backupDir)
}

if (import.meta.main) {
  try {
    const parsed = parseCli(process.argv.slice(2))
    if ('undo' in parsed) {
      const res = await runUndo(parsed)
      console.log(`${res.restored ? 'Undone' : 'Dry-run undo'}: ${res.manifest.to} -> ${res.manifest.from} (${res.actions.join(', ')})`)
    } else printSummary(await runRekey(parsed))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
