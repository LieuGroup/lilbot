/** Runs each registered engine's frozen rollback hook after the database is restored and before the
 *  previous release starts. Frozen with the watchdog under `<data>/deploy/runner/`, so it never
 *  depends on the checkout, the failed release, or a running engine registry. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { EngineRollbackHook, EngineRollbackResult } from '../engines/engine-ops'
import { command } from './process'

export const HOOKS_DIR = 'engine-hooks'
export const MANIFEST_FILE = 'manifest.json'
export const SAFE_ENGINE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
const SAFE_HOOK_FILE = /^[a-z0-9][a-z0-9_-]{0,63}\.ts$/
const DEFAULT_HOOK_TIMEOUT_MS = 90_000

export interface HookManifestEntry {
  engineId: string
  file: string
}

async function withTimeout<T>(work: () => Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), timeoutMs)
      })
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function validRollbackResult(value: unknown): value is EngineRollbackResult {
  if (!value || typeof value !== 'object') return false
  const { cleared, failed } = value as Partial<EngineRollbackResult>
  return typeof cleared === 'number' && Number.isInteger(cleared) && cleared >= 0 && typeof failed === 'number' && Number.isInteger(failed) && failed >= 0
}

/** Loads frozen engine rollback hooks from `<hooksDir>/manifest.json`. A single broken hook module
 *  returns a failing stub so other engines' rollback hooks still run. */
export async function loadRollbackHooks(hooksDir = join(import.meta.dir, HOOKS_DIR), hookTimeoutMs = DEFAULT_HOOK_TIMEOUT_MS): Promise<EngineRollbackHook[]> {
  const raw = JSON.parse(await readFile(join(hooksDir, MANIFEST_FILE), 'utf8')) as unknown
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('Invalid or empty rollback hook manifest')
  const hooks: EngineRollbackHook[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid rollback hook entry')
    const { engineId, file } = entry as Partial<HookManifestEntry>
    if (typeof engineId !== 'string' || !SAFE_ENGINE_ID.test(engineId) || typeof file !== 'string' || !SAFE_HOOK_FILE.test(file)) {
      throw new Error('Invalid rollback hook manifest entry')
    }
    if (seen.has(engineId)) throw new Error(`Duplicate rollback hook entry for ${engineId}`)
    seen.add(engineId)
    try {
      const mod = await withTimeout(
        () => import(join(hooksDir, file)) as Promise<{ rollbackHook?: EngineRollbackHook }>,
        hookTimeoutMs,
        `Timed out loading rollback hook for ${engineId}`
      )
      if (!mod.rollbackHook || mod.rollbackHook.engineId !== engineId || typeof mod.rollbackHook.rollback !== 'function') {
        throw new Error(`Invalid rollback hook module for ${engineId}`)
      }
      hooks.push(mod.rollbackHook)
    } catch {
      hooks.push({
        engineId,
        rollback: async context => ({ cleared: 0, failed: context.profiles.length || 1 })
      })
    }
  }
  return hooks
}

/** Runs every frozen engine rollback hook against the restored database and the service unit's printed
 *  `Environment` (null when systemd could not say). Never throws or stalls rollback: unreadable DB,
 *  missing/empty manifest, unmatched engines, hook timeouts, or malformed results are counted as failed. */
export async function runEngineRollbacks(
  database: string,
  printed: string | null,
  options: { hooksDir?: string; hooks?: readonly EngineRollbackHook[]; hookTimeoutMs?: number } = {}
): Promise<EngineRollbackResult> {
  const hookTimeoutMs = options.hookTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS
  const profilesByEngine = new Map<string, string[]>()
  let totalProfiles = 0
  try {
    const db = new DatabaseSync(database, { readOnly: true })
    try {
      const rows = db.prepare('SELECT engine_id, engine_bot_id FROM bots WHERE deletion IS NULL').all() as { engine_id: string; engine_bot_id: string }[]
      for (const row of rows) {
        const list = profilesByEngine.get(row.engine_id) ?? []
        list.push(row.engine_bot_id)
        profilesByEngine.set(row.engine_id, list)
        totalProfiles++
      }
    } finally {
      db.close()
    }
  } catch {
    return { cleared: 0, failed: 1 }
  }
  let hooks: readonly EngineRollbackHook[]
  try {
    hooks = options.hooks ?? (await loadRollbackHooks(options.hooksDir, hookTimeoutMs))
  } catch {
    return { cleared: 0, failed: totalProfiles || 1 }
  }
  if (hooks.length === 0 || printed === null) return { cleared: 0, failed: totalProfiles || 1 }
  const hooksByEngine = new Map<string, EngineRollbackHook>()
  for (const hook of hooks) hooksByEngine.set(hook.engineId, hook)
  const runCommand = (args: string[], timeoutMs = 30_000, env?: NodeJS.ProcessEnv) => command(args, undefined, timeoutMs, env)
  const result = { cleared: 0, failed: 0 }
  for (const [engineId, profiles] of profilesByEngine) {
    const hook = hooksByEngine.get(engineId)
    if (!hook) {
      result.failed += profiles.length
      continue
    }
    try {
      const outcome = await withTimeout(() => hook.rollback({ profiles, printedEnvironment: printed, runCommand }), hookTimeoutMs, `Rollback hook for ${engineId} timed out`)
      if (!validRollbackResult(outcome)) {
        result.failed += profiles.length
        continue
      }
      result.cleared += outcome.cleared
      result.failed += outcome.failed
    } catch {
      result.failed += profiles.length
    }
  }
  return result
}
