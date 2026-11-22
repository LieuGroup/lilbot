/** Online backup and full `--undo` restore for bot re-keying. Never logs secrets. */
import { Database } from 'bun:sqlite'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { backupDatabase, restoreDatabase } from '../../server/deploy/backup'
import { removeJournal, writeAtomicPrivate } from './rekey-journal'
import { lstatNoSymlink, profileDir } from './rekey-preflight'

const HERMES_BACKUP_FILES = ['lilbot-memory.json', 'lilbot-skills.json', 'lilbot-computers.json', 'lilbot-applied.json', '.env'] as const

export interface RekeyManifest {
  version: 1
  createdAt: string
  from: string
  to: string
  engineBotId: string
  dataDir: string
  workspacesDir: string | null
  hermesHome: string | null
  hadWorkspace: boolean
  hadArchive: boolean
  hadComputerKey: boolean
  hermesFilesPresent: string[]
}

/** Creates a 0700 backup directory with SQLite online backup, computer-server-key.pem, and Hermes files (including .env). */
export async function createRekeyBackup(params: {
  dataDir: string
  workspacesDir: string | null
  hermesHome: string | null
  from: string
  to: string
  engineBotId: string
}): Promise<string> {
  const root = join(params.dataDir, 'rekey-backups')
  mkdirSync(root, { recursive: true, mode: 0o700 })
  chmodSync(root, 0o700)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = join(root, `${stamp}-${params.from}-to-${params.to}`)
  mkdirSync(backupDir, { mode: 0o700 })
  chmodSync(backupDir, 0o700)

  await backupDatabase(join(params.dataDir, 'lilbot.db'), join(backupDir, 'lilbot.db'))

  let hadComputerKey = false
  const keySrc = join(params.dataDir, 'computer-server-key.pem')
  if (existsSync(keySrc)) {
    const keyDst = join(backupDir, 'computer-server-key.pem')
    copyFileSync(keySrc, keyDst)
    chmodSync(keyDst, 0o600)
    hadComputerKey = true
  }

  const hermesFilesPresent: string[] = []
  if (params.hermesHome) {
    const pDir = profileDir(params.hermesHome, params.engineBotId)
    const hermesDst = join(backupDir, 'hermes')
    mkdirSync(hermesDst, { mode: 0o700 })
    chmodSync(hermesDst, 0o700)
    for (const name of HERMES_BACKUP_FILES) {
      const src = join(pDir, name)
      if (!existsSync(src)) continue
      const dst = join(hermesDst, name)
      copyFileSync(src, dst)
      chmodSync(dst, 0o600)
      hermesFilesPresent.push(name)
    }
  }

  const manifest: RekeyManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    from: params.from,
    to: params.to,
    engineBotId: params.engineBotId,
    dataDir: params.dataDir,
    workspacesDir: params.workspacesDir,
    hermesHome: params.hermesHome,
    hadWorkspace: params.workspacesDir ? existsSync(join(params.workspacesDir, params.from)) : false,
    hadArchive: params.workspacesDir ? existsSync(join(params.workspacesDir, '.archive', params.from)) : false,
    hadComputerKey,
    hermesFilesPresent
  }
  writeAtomicPrivate(join(backupDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return backupDir
}

export function readManifest(backupDir: string): RekeyManifest {
  const path = join(backupDir, 'manifest.json')
  if (!existsSync(path)) throw new Error(`No rekey backup manifest found at ${path}.`)
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<RekeyManifest>
  if (parsed.version !== 1 || typeof parsed.from !== 'string' || typeof parsed.to !== 'string' || typeof parsed.dataDir !== 'string')
    throw new Error(`Invalid rekey backup manifest at ${path}.`)
  return parsed as RekeyManifest
}

/** Restores DB (online backup API), computer key, workspace/archive folders, and Hermes files from a backup directory. */
export async function restoreRekeyBackup(backupDir: string, dryRun: boolean) {
  const m = readManifest(backupDir)
  const backupDb = join(backupDir, 'lilbot.db')
  if (!existsSync(backupDb)) throw new Error(`Backup database missing at ${backupDb}.`)
  const check = new Database(backupDb, { readonly: true, strict: true })
  try {
    if (check.query<{ quick_check: string }, []>('PRAGMA quick_check').get()?.quick_check !== 'ok') throw new Error('Backup database failed PRAGMA quick_check.')
  } finally {
    check.close()
  }
  const actions: string[] = ['database']
  if (m.workspacesDir) {
    lstatNoSymlink(join(m.workspacesDir, m.from), 'old workspace')
    lstatNoSymlink(join(m.workspacesDir, m.to), 'new workspace')
    if (existsSync(join(m.workspacesDir, m.to)) && existsSync(join(m.workspacesDir, m.from))) throw new Error(`Cannot undo: both ${m.from} and ${m.to} workspace folders exist.`)
    if (existsSync(join(m.workspacesDir, m.to))) actions.push('workspace')
    const arcTo = join(m.workspacesDir, '.archive', m.to)
    const arcFrom = join(m.workspacesDir, '.archive', m.from)
    lstatNoSymlink(arcFrom, 'old archive')
    lstatNoSymlink(arcTo, 'new archive')
    if (existsSync(arcTo) && existsSync(arcFrom)) throw new Error(`Cannot undo: both ${m.from} and ${m.to} archive folders exist.`)
    if (existsSync(arcTo)) actions.push('archive')
  }
  if (m.hermesHome) {
    const pDir = profileDir(m.hermesHome, m.engineBotId)
    for (const name of HERMES_BACKUP_FILES) lstatNoSymlink(join(pDir, name), name)
    actions.push('hermes')
  }
  if (dryRun) return { manifest: m, actions, restored: false }

  if (m.hermesHome) {
    const pDir = profileDir(m.hermesHome, m.engineBotId)
    const present = new Set(m.hermesFilesPresent)
    for (const name of HERMES_BACKUP_FILES) {
      const dst = join(pDir, name)
      if (present.has(name)) {
        const src = join(backupDir, 'hermes', name)
        const tmp = `${dst}.rekey-undo-${process.pid}`
        copyFileSync(src, tmp)
        chmodSync(tmp, 0o600)
        renameSync(tmp, dst)
      } else rmSync(dst, { force: true })
    }
  }
  if (m.workspacesDir) {
    const wsTo = join(m.workspacesDir, m.to)
    const wsFrom = join(m.workspacesDir, m.from)
    if (existsSync(wsTo) && !existsSync(wsFrom)) renameSync(wsTo, wsFrom)
    const arcTo = join(m.workspacesDir, '.archive', m.to)
    const arcFrom = join(m.workspacesDir, '.archive', m.from)
    if (existsSync(arcTo) && !existsSync(arcFrom)) renameSync(arcTo, arcFrom)
  }
  await restoreDatabase(backupDb, join(m.dataDir, 'lilbot.db'))
  if (m.hadComputerKey) {
    const keyDst = join(m.dataDir, 'computer-server-key.pem')
    const keySrc = join(backupDir, 'computer-server-key.pem')
    if (!existsSync(keyDst) || !readFileSync(keyDst).equals(readFileSync(keySrc))) {
      const tmp = `${keyDst}.rekey-undo-${process.pid}`
      copyFileSync(keySrc, tmp)
      chmodSync(tmp, 0o600)
      renameSync(tmp, keyDst)
    }
  }
  removeJournal(m.dataDir)
  const verify = new Database(join(m.dataDir, 'lilbot.db'), { readonly: true, strict: true })
  try {
    if (!verify.query('SELECT 1 FROM bots WHERE id = ?').get(m.from)) throw new Error(`Restored database does not contain ${m.from}.`)
    if (verify.query('PRAGMA foreign_key_check').all().length > 0) throw new Error('Restored database failed PRAGMA foreign_key_check.')
    if (verify.query<{ integrity_check: string }, []>('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new Error('Restored database failed PRAGMA integrity_check.')
  } finally {
    verify.close()
  }
  return { manifest: m, actions, restored: true }
}
