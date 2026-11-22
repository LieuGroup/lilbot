/** Online backup creation, manifest validation, post-rekey fingerprinting, and integrity verification. Never logs secrets. */
import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { chmodSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { backupDatabase } from '../../server/deploy/backup'
import { snapshotDatabaseFingerprint, type TableFingerprint } from './rekey-check'
import { writeAtomicPrivate } from './rekey-journal'
import { assertRegularFile, HERMES_FILES, lstatNoSymlink, profileDir } from './rekey-preflight'

const ALLOWED_HERMES = new Set<string>(HERMES_FILES)

export interface RekeyManifest {
  version: 1
  createdAt: string
  completedAt?: string
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
  fileDigests?: Record<string, string>
  postRekey?: Record<string, TableFingerprint>
}

const sha256File = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

/** Creates a 0700 backup directory with SQLite online backup, computer-server-key.pem, Hermes files (including .env), and digests. */
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

  const backupDb = join(backupDir, 'lilbot.db')
  await backupDatabase(join(params.dataDir, 'lilbot.db'), backupDb)
  const fileDigests: Record<string, string> = { 'lilbot.db': sha256File(backupDb) }

  let hadComputerKey = false
  const keySrc = join(params.dataDir, 'computer-server-key.pem')
  if (existsSync(keySrc)) {
    const keyDst = join(backupDir, 'computer-server-key.pem')
    copyFileSync(keySrc, keyDst)
    chmodSync(keyDst, 0o600)
    fileDigests['computer-server-key.pem'] = sha256File(keyDst)
    hadComputerKey = true
  }

  const hermesFilesPresent: string[] = []
  if (params.hermesHome) {
    const pDir = profileDir(params.hermesHome, params.engineBotId)
    const hermesDst = join(backupDir, 'hermes')
    mkdirSync(hermesDst, { mode: 0o700 })
    chmodSync(hermesDst, 0o700)
    for (const name of HERMES_FILES) {
      const src = join(pDir, name)
      if (!existsSync(src)) continue
      const dst = join(hermesDst, name)
      copyFileSync(src, dst)
      chmodSync(dst, 0o600)
      fileDigests[`hermes/${name}`] = sha256File(dst)
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
    hermesFilesPresent,
    fileDigests
  }
  writeAtomicPrivate(join(backupDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return backupDir
}

/** Updates `manifest.json` with the post-rekey database fingerprint so `--undo` detects post-rekey writes. */
export function recordPostRekeyManifest(backupDir: string, dbPath: string, completed: boolean) {
  const m = readManifest(backupDir)
  const db = new Database(dbPath, { readonly: true, strict: true })
  let postRekey: Record<string, TableFingerprint>
  try {
    postRekey = snapshotDatabaseFingerprint(db)
  } finally {
    db.close()
  }
  const updated: RekeyManifest = { ...m, postRekey, ...(completed ? { completedAt: new Date().toISOString() } : {}) }
  writeAtomicPrivate(join(backupDir, 'manifest.json'), `${JSON.stringify(updated, null, 2)}\n`)
}

export function readManifest(backupDir: string): RekeyManifest {
  const dirStat = lstatNoSymlink(backupDir, 'backup directory')
  if (!dirStat?.isDirectory()) throw new Error(`Backup directory does not exist or is not a directory: ${backupDir}`)
  const path = join(backupDir, 'manifest.json')
  assertRegularFile(path, 'backup manifest', constants.R_OK, true)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error(`Corrupt rekey backup manifest at ${path}.`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`Invalid rekey backup manifest at ${path}.`)
  const m = parsed as Record<string, unknown>
  const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0
  const valid =
    m.version === 1 &&
    str(m.from) &&
    str(m.to) &&
    str(m.engineBotId) &&
    str(m.dataDir) &&
    (m.workspacesDir === null || str(m.workspacesDir)) &&
    (m.hermesHome === null || str(m.hermesHome)) &&
    typeof m.hadWorkspace === 'boolean' &&
    typeof m.hadArchive === 'boolean' &&
    typeof m.hadComputerKey === 'boolean' &&
    Array.isArray(m.hermesFilesPresent) &&
    m.hermesFilesPresent.every(name => typeof name === 'string' && ALLOWED_HERMES.has(name))
  if (!valid) throw new Error(`Invalid rekey backup manifest at ${path}.`)
  return m as unknown as RekeyManifest
}

function assertBackupFile(backupDir: string, rel: string, digests?: Record<string, string>) {
  const full = join(backupDir, rel)
  assertRegularFile(full, `backup file (${rel})`, constants.R_OK, true)
  const expected = digests?.[rel]
  if (expected && sha256File(full) !== expected) throw new Error(`Backup file failed integrity check (${rel}): ${full}`)
}

/** Verifies every manifest-listed backup file is present, readable, non-symlink, intact, and DB passes quick_check. */
export function validateBackupIntegrity(backupDir: string, m: RekeyManifest) {
  assertBackupFile(backupDir, 'lilbot.db', m.fileDigests)
  if (m.hadComputerKey) assertBackupFile(backupDir, 'computer-server-key.pem', m.fileDigests)
  for (const name of m.hermesFilesPresent) assertBackupFile(backupDir, join('hermes', name), m.fileDigests)
  const db = new Database(join(backupDir, 'lilbot.db'), { readonly: true, strict: true })
  try {
    if (db.query<{ quick_check: string }, []>('PRAGMA quick_check').get()?.quick_check !== 'ok') throw new Error('Backup database failed PRAGMA quick_check.')
    if (!db.query('SELECT 1 FROM bots WHERE id = ?').get(m.from)) throw new Error(`Backup database does not contain original bot "${m.from}".`)
  } finally {
    db.close()
  }
}

export function isCompleteBackup(backupDir: string): boolean {
  try {
    const m = readManifest(backupDir)
    validateBackupIntegrity(backupDir, m)
    return true
  } catch {
    return false
  }
}
