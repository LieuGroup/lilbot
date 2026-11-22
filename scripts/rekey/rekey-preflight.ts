/** Pre-flight disk, symlink (including dangling), JSON parseability, permission, and free-space checks. */
import { accessSync, constants, existsSync, lstatSync, readFileSync, statfsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const HERMES_FILES = ['lilbot-memory.json', 'lilbot-skills.json', 'lilbot-computers.json', 'lilbot-applied.json', '.env'] as const
const HERMES_JSON_FILES = ['lilbot-memory.json', 'lilbot-skills.json', 'lilbot-computers.json', 'lilbot-applied.json'] as const

export const profileDir = (hermesHome: string, engineBotId: string) => (engineBotId === 'default' ? hermesHome : join(hermesHome, 'profiles', engineBotId))

/** Refuses symlinks including dangling symlinks (calls lstatSync directly instead of gating on existsSync). */
export function lstatNoSymlink(path: string, label: string) {
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (stat.isSymbolicLink()) throw new Error(`Refusing to touch symlink at ${label}: ${path}`)
}

function assertWritableDir(dir: string, label: string) {
  lstatNoSymlink(dir, label)
  if (!existsSync(dir)) throw new Error(`Required ${label} directory does not exist: ${dir}`)
  if (!statSync(dir).isDirectory()) throw new Error(`${label} is not a directory: ${dir}`)
  try {
    accessSync(dir, constants.R_OK | constants.W_OK | constants.X_OK)
  } catch {
    throw new Error(`${label} directory is not readable and writable: ${dir}`)
  }
}

function assertFreeSpace(dir: string, neededBytes: number, label: string) {
  const fs = statfsSync(dir)
  const available = Number(fs.bavail) * Number(fs.bsize)
  if (Number.isFinite(available) && available < neededBytes) {
    throw new Error(`Insufficient free disk space in ${label}: need ${neededBytes} bytes, have ${available} bytes.`)
  }
}

export function parseJsonObject(path: string, label: string): Record<string, unknown> {
  try {
    accessSync(path, constants.R_OK | constants.W_OK)
  } catch {
    throw new Error(`${label} is not readable and writable: ${path}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error(`${label} contains invalid JSON: ${path}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label} must contain a JSON object: ${path}`)
  return parsed as Record<string, unknown>
}

/** Validates every directory, target, symlink (including dangling), JSON file, permission, and free space before any write. */
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
  lstatNoSymlink(dbPath, 'database')
  const dbBytes = existsSync(dbPath) ? statSync(dbPath).size : 0
  assertFreeSpace(params.dataDir, params.minDataBytes ?? dbBytes * 3 + 16 * 1024 * 1024, 'data directory')

  if (params.workspacesDir !== null) {
    assertWritableDir(params.workspacesDir, 'workspaces')
    const src = join(params.workspacesDir, params.oldId)
    const dst = join(params.workspacesDir, params.newId)
    lstatNoSymlink(src, 'old workspace')
    lstatNoSymlink(dst, 'new workspace')
    if (existsSync(src) && existsSync(dst)) throw new Error(`Both old and new workspace folders exist (${params.oldId} and ${params.newId}); resolve manually before running.`)
    const archive = join(params.workspacesDir, '.archive')
    lstatNoSymlink(archive, 'workspace archive')
    if (existsSync(archive)) {
      assertWritableDir(archive, 'workspace archive')
      const arcSrc = join(archive, params.oldId)
      const arcDst = join(archive, params.newId)
      lstatNoSymlink(arcSrc, 'old archived workspace')
      lstatNoSymlink(arcDst, 'new archived workspace')
      if (existsSync(arcSrc) && existsSync(arcDst))
        throw new Error(`Both old and new archive folders exist (${params.oldId} and ${params.newId}); resolve manually before running.`)
    }
  }

  if (params.hermesHome !== null) {
    assertWritableDir(params.hermesHome, 'Hermes home')
    const pDir = profileDir(params.hermesHome, params.engineBotId)
    assertWritableDir(pDir, `Hermes profile (${params.engineBotId})`)
    assertFreeSpace(pDir, 1024 * 1024, 'Hermes profile directory')
    for (const name of HERMES_FILES) lstatNoSymlink(join(pDir, name), name)
    for (const name of HERMES_JSON_FILES) {
      const file = join(pDir, name)
      if (!existsSync(file)) continue
      const parsed = parseJsonObject(file, name)
      if (name === 'lilbot-memory.json') {
        const tokenFile = existsSync(join(params.dataDir, 'engine-token')) ? join(params.dataDir, 'engine-token') : typeof parsed.token_file === 'string' ? parsed.token_file : ''
        if (tokenFile) {
          lstatNoSymlink(tokenFile, 'engine-token')
          try {
            if (!readFileSync(tokenFile, 'utf8').trim()) throw new Error('empty')
          } catch {
            throw new Error(`Token file referenced for lilbot-memory.json is unreadable or empty: ${tokenFile}`)
          }
        }
      }
    }
  }
}
