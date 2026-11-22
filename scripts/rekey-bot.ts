/** One-time operator CLI to re-key a LilBot bot id (or undo from backup). Requires explicit paths (no production defaults),
 *  refuses unknown flags, live service/locks, deleted bots, and in-flight work. Defaults to dry run unless `--yes` is passed. */
import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createRekeyBackup, isCompleteBackup, readManifest, recordPostRekeyManifest } from './rekey/rekey-backup'
import { countKeptInvariants, verifyDatabaseRekey } from './rekey/rekey-check'
import { parseCli, printSummary, type RekeyOptions, type RekeySummary, type UndoOptions } from './rekey/rekey-cli'
import { applyDatabaseRekey, inspectBotState, previewDatabaseRekey } from './rekey/rekey-db'
import { applyDiskRekey, type DiskReport, verifyDiskRekey } from './rekey/rekey-disk'
import { assertDatabaseNotInUse } from './rekey/rekey-guard'
import { assertJournalMatchesRekey, type RekeyJournal, readJournal, removeJournal, writeJournal } from './rekey/rekey-journal'
import { lstatNoSymlink, preflightDisk } from './rekey/rekey-preflight'
import { inFlightCounts } from './rekey/rekey-targets'
import { restoreRekeyBackup } from './rekey/rekey-undo'

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
  return restoreRekeyBackup(options.undo, { dryRun: options.dryRun, force: options.force, injectFailure: options.testHooks?.injectFailure })
}

export async function runRekey(options: RekeyOptions): Promise<RekeySummary> {
  const started = performance.now()
  if (!SAFE_ID.test(options.from)) throw new Error(`Invalid --from bot id: ${options.from}`)
  if (options.to !== undefined && (!SAFE_ID.test(options.to) || options.to === options.from)) throw new Error(`Invalid --to bot id: ${options.to}`)
  const dbPath = join(options.dataDir, 'lilbot.db')
  lstatNoSymlink(dbPath, 'database')
  if (!existsSync(dbPath)) throw new Error(`No LilBot database at ${dbPath}.`)
  if (!options.dryRun) assertDatabaseNotInUse(options.dataDir, options.testHooks?.serviceProbe)

  const existingJournal = readJournal(options.dataDir)
  if (existingJournal) assertJournalMatchesRekey(existingJournal, options)

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
      if (existingJournal) {
        if (isCompleteBackup(existingJournal.backupDir)) recordPostRekeyManifest(existingJournal.backupDir, dbPath, true)
        removeJournal(options.dataDir)
      }
    }
    return done(options.dryRun ? 'dry-run' : 'already-rekeyed', {}, 0, false, disk, dbCheck.kept, existingJournal?.backupDir)
  }

  if (options.dryRun) {
    const [preview, kept] = withReadonlyDb(dbPath, db => [previewDatabaseRekey(db, options.from, targetId), countKeptInvariants(db, engineBotId)] as const)
    const disk = applyDiskRekey({ ...diskArgs, dryRun: true })
    return done('dry-run', preview.perTable, preview.totalChanges, options.clearMainChat && preview.hasMainChat, disk, kept)
  }

  const backupDir =
    existingJournal?.steps.backup && isCompleteBackup(existingJournal.backupDir)
      ? existingJournal.backupDir
      : await createRekeyBackup({ dataDir: options.dataDir, workspacesDir: options.workspacesDir, hermesHome: options.hermesHome, from: options.from, to: targetId, engineBotId })
  const journal: RekeyJournal = {
    version: 1,
    mode: 'rekey',
    from: options.from,
    to: targetId,
    engineBotId,
    backupDir,
    dataDir: options.dataDir,
    workspacesDir: options.workspacesDir,
    hermesHome: options.hermesHome,
    clearMainChat: options.clearMainChat,
    steps: { ...(existingJournal?.steps ?? { backup: true, db: false, workspace: false, archive: false, hermes: false }), backup: true }
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
  recordPostRekeyManifest(backupDir, dbPath, false)
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
    await restoreRekeyBackup(backupDir, { dryRun: false, force: true, internalRollback: true })
    throw new Error(`Post-DB step failed (fully rolled back from backup ${backupDir}): ${error instanceof Error ? error.message : String(error)}`)
  }
  recordPostRekeyManifest(backupDir, dbPath, true)
  removeJournal(options.dataDir)
  return done('applied', dbResult.tableCounts, dbResult.totalChanges, dbResult.clearedMainChat, disk, dbResult.kept, backupDir)
}

if (import.meta.main) {
  try {
    const parsed = parseCli(process.argv.slice(2))
    if ('undo' in parsed) {
      const res = await runUndo(parsed)
      const note = res.postRekeyChanges.length ? ` (discarded post-rekey changes in ${res.postRekeyChanges.length} table(s))` : ''
      console.log(`${res.restored ? 'Undone' : 'Dry-run undo'}: ${res.manifest.to} -> ${res.manifest.from} (${res.actions.join(', ')})${note}`)
    } else printSummary(await runRekey(parsed))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
