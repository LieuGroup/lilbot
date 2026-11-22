/** Pre-flight disk, symlink (including dangling), file-type, JSON, permission, and free-space checks. */
import { accessSync, constants, existsSync, lstatSync, readFileSync, statfsSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const HERMES_FILES = ['lilbot-memory.json', 'lilbot-skills.json', 'lilbot-computers.json', 'lilbot-applied.json', '.env'] as const
const HERMES_JSON_FILES = ['lilbot-memory.json', 'lilbot-skills.json', 'lilbot-computers.json', 'lilbot-applied.json'] as const

export const profileDir = (hermesHome: string, engineBotId: string) => (engineBotId === 'default' ? hermesHome : join(hermesHome, 'profiles', engineBotId))

/** Refuses symlinks including dangling symlinks (calls lstatSync directly instead of gating on existsSync). */
export function lstatNoSymlink(path: string, label: string) {
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  if (stat.isSymbolicLink()) throw new Error(`Refusing to touch symlink at ${label}: ${path}`)
  return stat
}

export function assertWritableDir(dir: string, label: string) {
  const stat = lstatNoSymlink(dir, label)
  if (!stat) throw new Error(`Required ${label} directory does not exist: ${dir}`)
  if (!stat.isDirectory()) throw new Error(`${label} is not a directory: ${dir}`)
  try {
    accessSync(dir, constants.R_OK | constants.W_OK | constants.X_OK)
  } catch {
    throw new Error(`${label} directory is not readable and writable: ${dir}`)
  }
}

export function assertOptionalDir(path: string, label: string) {
  const stat = lstatNoSymlink(path, label)
  if (stat && !stat.isDirectory()) throw new Error(`${label} is not a directory: ${path}`)
  return Boolean(stat)
}

export function assertRegularFile(path: string, label: string, mode: number, required = false) {
  const stat = lstatNoSymlink(path, label)
  if (!stat) {
    if (required) throw new Error(`Required ${label} file does not exist: ${path}`)
    return false
  }
  if (!stat.isFile()) throw new Error(`${label} is not a regular file: ${path}`)
  try {
    accessSync(path, mode)
  } catch {
    const need = mode === constants.R_OK ? 'readable' : 'readable and writable'
    throw new Error(`${label} is not ${need}: ${path}`)
  }
  return true
}

function assertFreeSpace(dir: string, neededBytes: number, label: string) {
  const fs = statfsSync(dir)
  const available = Number(fs.bavail) * Number(fs.bsize)
  if (Number.isFinite(available) && available < neededBytes) {
    throw new Error(`Insufficient free disk space in ${label}: need ${neededBytes} bytes, have ${available} bytes.`)
  }
}

export function parseJsonObject(path: string, label: string): Record<string, unknown> {
  assertRegularFile(path, label, constants.R_OK | constants.W_OK, true)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error(`${label} contains invalid JSON: ${path}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label} must contain a JSON object: ${path}`)
  return parsed as Record<string, unknown>
}

/** Validates every directory, target, symlink (including dangling), file type, JSON file, permission, and free space before any write. */
export function preflightDisk(params: {
  dataDir: string
  workspacesDir: string | null
  hermesHome: string | null
  engineBotId: string
  oldId: string
  newId: string
  minDataBytes?: number
}) {
  assertWritableDir(params.dataDir, 'data')
  const dbPath = join(params.dataDir, 'lilbot.db')
  assertRegularFile(dbPath, 'database', constants.R_OK | constants.W_OK, true)
  const dbBytes = statSync(dbPath).size
  assertFreeSpace(params.dataDir, params.minDataBytes ?? dbBytes * 3 + 16 * 1024 * 1024, 'data directory')

  const backupsDir = join(params.dataDir, 'rekey-backups')
  if (lstatNoSymlink(backupsDir, 'rekey-backups')) assertWritableDir(backupsDir, 'rekey-backups')
  assertRegularFile(join(params.dataDir, 'rekey-journal.json'), 'rekey-journal.json', constants.R_OK | constants.W_OK)
  assertRegularFile(join(params.dataDir, 'computer-server-key.pem'), 'computer-server-key.pem', constants.R_OK)
  const dataToken = join(params.dataDir, 'engine-token')
  if (assertRegularFile(dataToken, 'engine-token', constants.R_OK) && !readFileSync(dataToken, 'utf8').trim()) {
    throw new Error(`engine-token is empty: ${dataToken}`)
  }

  if (params.workspacesDir !== null) {
    assertWritableDir(params.workspacesDir, 'workspaces')
    const hasSrc = assertOptionalDir(join(params.workspacesDir, params.oldId), 'old workspace')
    const hasDst = assertOptionalDir(join(params.workspacesDir, params.newId), 'new workspace')
    if (hasSrc && hasDst) throw new Error(`Both old and new workspace folders exist (${params.oldId} and ${params.newId}); resolve manually before running.`)
    const archive = join(params.workspacesDir, '.archive')
    if (lstatNoSymlink(archive, 'workspace archive')) {
      assertWritableDir(archive, 'workspace archive')
      const hasArcSrc = assertOptionalDir(join(archive, params.oldId), 'old archived workspace')
      const hasArcDst = assertOptionalDir(join(archive, params.newId), 'new archived workspace')
      if (hasArcSrc && hasArcDst) throw new Error(`Both old and new archive folders exist (${params.oldId} and ${params.newId}); resolve manually before running.`)
    }
  }

  if (params.hermesHome !== null) {
    assertWritableDir(params.hermesHome, 'Hermes home')
    const pDir = profileDir(params.hermesHome, params.engineBotId)
    assertWritableDir(pDir, `Hermes profile (${params.engineBotId})`)
    assertFreeSpace(pDir, 1024 * 1024, 'Hermes profile directory')
    assertRegularFile(join(pDir, '.env'), '.env', constants.R_OK)
    for (const name of HERMES_JSON_FILES) {
      const file = join(pDir, name)
      if (!lstatNoSymlink(file, name)) continue
      const parsed = parseJsonObject(file, name)
      if (name === 'lilbot-memory.json') {
        const tokenFile = existsSync(dataToken) ? dataToken : typeof parsed.token_file === 'string' ? parsed.token_file : ''
        if (tokenFile) {
          assertRegularFile(tokenFile, 'engine-token', constants.R_OK, true)
          if (!readFileSync(tokenFile, 'utf8').trim()) throw new Error(`Token file referenced for lilbot-memory.json is empty: ${tokenFile}`)
        }
      }
    }
  }
}
