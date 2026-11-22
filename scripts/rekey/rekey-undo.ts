/** Verified, crash-resumable `--undo` restore for bot re-keying. Never deletes post-created `.env` or wipes unforced post-rekey writes. */
import { Database } from 'bun:sqlite'
import { chmodSync, constants, copyFileSync, existsSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { restoreDatabase } from '../../server/deploy/backup'
import { type RekeyManifest, readManifest, validateBackupIntegrity } from './rekey-backup'
import { diffDatabaseFingerprints, snapshotDatabaseFingerprint, type TableDiff } from './rekey-check'
import { readJournal, removeJournal, writeJournal } from './rekey-journal'
import { assertOptionalDir, assertRegularFile, assertWritableDir, HERMES_FILES, lstatNoSymlink, parseJsonObject, profileDir } from './rekey-preflight'

export type UndoFailurePoint = 'undo-hermes' | 'undo-workspace' | 'undo-archive' | 'undo-db' | 'undo-key'

export interface RestoreOptions {
  dryRun: boolean
  force?: boolean
  internalRollback?: boolean
  injectFailure?: UndoFailurePoint
}

const formatDiffs = (diffs: TableDiff[]) => diffs.map(d => (d.delta === 0 ? `${d.table} (modified)` : `${d.table} (${d.delta > 0 ? '+' : ''}${d.delta} rows)`)).join(', ')

function validateTargets(m: RekeyManifest) {
  assertWritableDir(m.dataDir, 'data')
  assertRegularFile(join(m.dataDir, 'lilbot.db'), 'database', constants.R_OK | constants.W_OK, true)
  if (m.hadComputerKey) assertRegularFile(join(m.dataDir, 'computer-server-key.pem'), 'computer-server-key.pem', constants.R_OK | constants.W_OK)
  if (m.workspacesDir) {
    assertWritableDir(m.workspacesDir, 'workspaces')
    if (assertOptionalDir(join(m.workspacesDir, m.from), 'old workspace') && assertOptionalDir(join(m.workspacesDir, m.to), 'new workspace'))
      throw new Error(`Cannot undo: both ${m.from} and ${m.to} workspace folders exist.`)
    const archive = join(m.workspacesDir, '.archive')
    if (lstatNoSymlink(archive, 'workspace archive')) {
      assertWritableDir(archive, 'workspace archive')
      if (assertOptionalDir(join(archive, m.from), 'old archive') && assertOptionalDir(join(archive, m.to), 'new archive'))
        throw new Error(`Cannot undo: both ${m.from} and ${m.to} archive folders exist.`)
    }
  }
  if (m.hermesHome) {
    assertWritableDir(m.hermesHome, 'Hermes home')
    const pDir = profileDir(m.hermesHome, m.engineBotId)
    assertWritableDir(pDir, `Hermes profile (${m.engineBotId})`)
    const present = new Set(m.hermesFilesPresent)
    for (const name of HERMES_FILES) {
      if (name === '.env' && !present.has(name)) continue
      const dst = join(pDir, name)
      if (lstatNoSymlink(dst, name)) assertRegularFile(dst, name, constants.R_OK | constants.W_OK, true)
    }
  }
}

function inspectLiveDb(dbPath: string, from: string, to: string) {
  const db = new Database(dbPath, { readonly: true, strict: true })
  try {
    return {
      hasFrom: Boolean(db.query('SELECT 1 FROM bots WHERE id = ?').get(from)),
      hasTo: Boolean(db.query('SELECT 1 FROM bots WHERE id = ?').get(to)),
      fingerprint: snapshotDatabaseFingerprint(db)
    }
  } finally {
    db.close()
  }
}

function restoreHermes(backupDir: string, m: RekeyManifest) {
  if (!m.hermesHome) return
  const pDir = profileDir(m.hermesHome, m.engineBotId)
  const present = new Set(m.hermesFilesPresent)
  for (const name of HERMES_FILES) {
    const dst = join(pDir, name)
    if (present.has(name)) {
      const tmp = `${dst}.rekey-undo-${process.pid}`
      copyFileSync(join(backupDir, 'hermes', name), tmp)
      chmodSync(tmp, 0o600)
      renameSync(tmp, dst)
    } else if (name === 'lilbot-applied.json') rmSync(dst, { force: true })
    else if (name !== '.env' && existsSync(dst)) {
      try {
        const parsed = parseJsonObject(dst, name)
        if (parsed.bot_id === m.to || parsed.botId === m.to) rmSync(dst, { force: true })
      } catch {}
    }
  }
}

/** Validates the full backup and live state before mutating anything; writes an undo journal so SIGKILL is resumable. */
export async function restoreRekeyBackup(backupDir: string, options: RestoreOptions) {
  const resolvedBackup = resolve(backupDir)
  const m = readManifest(resolvedBackup)
  validateBackupIntegrity(resolvedBackup, m)
  validateTargets(m)

  const journal = readJournal(m.dataDir)
  const matchingJournal = journal !== null && resolve(journal.backupDir) === resolvedBackup && journal.from === m.from && journal.to === m.to
  if (journal !== null && !matchingJournal) {
    throw new Error(`Cannot undo: unfinished rekey journal belongs to another run ("${journal.from}" -> "${journal.to}", backup ${journal.backupDir}).`)
  }
  const liveDb = join(m.dataDir, 'lilbot.db')
  const live = inspectLiveDb(liveDb, m.from, m.to)
  const wsFrom = m.workspacesDir ? join(m.workspacesDir, m.from) : null
  const wsTo = m.workspacesDir ? join(m.workspacesDir, m.to) : null
  const arcFrom = m.workspacesDir ? join(m.workspacesDir, '.archive', m.from) : null
  const arcTo = m.workspacesDir ? join(m.workspacesDir, '.archive', m.to) : null

  if (matchingJournal) {
    if (!live.hasTo && !live.hasFrom) throw new Error(`Cannot undo: neither "${m.from}" nor "${m.to}" exists in the live database.`)
    if (m.hadWorkspace && wsFrom && wsTo && !existsSync(wsFrom) && !existsSync(wsTo))
      throw new Error(`Cannot undo: expected workspace folder for "${m.from}" or "${m.to}" is missing.`)
    if (m.hadArchive && arcFrom && arcTo && !existsSync(arcFrom) && !existsSync(arcTo))
      throw new Error(`Cannot undo: expected archive folder for "${m.from}" or "${m.to}" is missing.`)
  } else {
    if (live.hasFrom && !live.hasTo) throw new Error(`Cannot undo: bot "${m.from}" is already present and "${m.to}" is absent (this backup was already undone or never applied).`)
    if (!live.hasTo) throw new Error(`Cannot undo: target bot "${m.to}" is not present in the live database (stale backup from an earlier re-key).`)
    if (live.hasFrom) throw new Error(`Cannot undo: both "${m.from}" and "${m.to}" exist in the live database.`)
    if (m.hadWorkspace && wsTo && !existsSync(wsTo)) throw new Error(`Cannot undo: expected workspace folder "${m.to}" is missing (stale backup or moved folder).`)
    if (m.hadArchive && arcTo && !existsSync(arcTo)) throw new Error(`Cannot undo: expected archive folder "${m.to}" is missing.`)
  }

  let postRekeyChanges: TableDiff[] = []
  const skipDiffCheck = options.internalRollback || (matchingJournal && journal?.mode === 'undo')
  if (!skipDiffCheck && live.hasTo) {
    if (m.postRekey) {
      postRekeyChanges = diffDatabaseFingerprints(m.postRekey, live.fingerprint)
      if (postRekeyChanges.length > 0 && !options.force) {
        throw new Error(
          `Refusing to undo: live database was modified after re-key (${formatDiffs(postRekeyChanges)}). Re-run with --force --yes to discard post-rekey changes and restore the backup.`
        )
      }
    } else if (!matchingJournal && !options.force) {
      throw new Error('Refusing to undo: backup manifest has no post-rekey fingerprint to verify against post-rekey writes. Re-run with --force --yes to restore anyway.')
    }
  }

  const actions: string[] = ['database']
  if (wsTo && existsSync(wsTo)) actions.push('workspace')
  if (arcTo && existsSync(arcTo)) actions.push('archive')
  if (m.hermesHome) actions.push('hermes')
  if (m.hadComputerKey) actions.push('computer-key')
  if (options.dryRun) return { manifest: m, actions, postRekeyChanges, restored: false }

  const failIf = (point: UndoFailurePoint) => {
    if (options.injectFailure === point) throw new Error(`Injected failure at ${point}`)
  }

  writeJournal(m.dataDir, {
    version: 1,
    mode: 'undo',
    from: m.from,
    to: m.to,
    engineBotId: m.engineBotId,
    backupDir: resolvedBackup,
    dataDir: m.dataDir,
    workspacesDir: m.workspacesDir,
    hermesHome: m.hermesHome,
    clearMainChat: false,
    steps: { backup: true, db: false, workspace: false, archive: false, hermes: false }
  })

  failIf('undo-hermes')
  restoreHermes(resolvedBackup, m)
  if (wsTo && wsFrom && existsSync(wsTo) && !existsSync(wsFrom)) {
    failIf('undo-workspace')
    renameSync(wsTo, wsFrom)
  }
  if (arcTo && arcFrom && existsSync(arcTo) && !existsSync(arcFrom)) {
    failIf('undo-archive')
    renameSync(arcTo, arcFrom)
  }
  failIf('undo-db')
  await restoreDatabase(join(resolvedBackup, 'lilbot.db'), liveDb)
  if (m.hadComputerKey) {
    failIf('undo-key')
    const keyDst = join(m.dataDir, 'computer-server-key.pem')
    const keySrc = join(resolvedBackup, 'computer-server-key.pem')
    if (!existsSync(keyDst) || !readFileSync(keyDst).equals(readFileSync(keySrc))) {
      const tmp = `${keyDst}.rekey-undo-${process.pid}`
      copyFileSync(keySrc, tmp)
      chmodSync(tmp, 0o600)
      renameSync(tmp, keyDst)
    }
  }

  const verify = new Database(liveDb, { readonly: true, strict: true })
  try {
    if (!verify.query('SELECT 1 FROM bots WHERE id = ?').get(m.from)) throw new Error(`Restored database does not contain ${m.from}.`)
    if (verify.query('SELECT 1 FROM bots WHERE id = ?').get(m.to)) throw new Error(`Restored database still contains ${m.to}.`)
    if (verify.query('PRAGMA foreign_key_check').all().length > 0) throw new Error('Restored database failed PRAGMA foreign_key_check.')
    if (verify.query<{ integrity_check: string }, []>('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new Error('Restored database failed PRAGMA integrity_check.')
  } finally {
    verify.close()
  }
  if (m.hadWorkspace && wsFrom && !existsSync(wsFrom)) throw new Error(`Restored workspace folder missing: ${wsFrom}`)
  if (m.hadArchive && arcFrom && !existsSync(arcFrom)) throw new Error(`Restored archive folder missing: ${arcFrom}`)
  removeJournal(m.dataDir)
  return { manifest: m, actions, postRekeyChanges, restored: true }
}
