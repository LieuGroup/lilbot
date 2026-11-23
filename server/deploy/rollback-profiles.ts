/** Runs each registered engine's frozen rollback hook after the database is restored and before the
 *  previous release starts. Frozen with the watchdog under `<data>/deploy/runner/`, so it never
 *  depends on the checkout, the failed release, or a running engine registry. */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { EngineRollbackDescriptor, EngineRollbackHook, EngineRollbackResult } from '../engines/engine-ops'
import { command } from './process'

const HOOKS_DIR = 'engine-hooks'
const MANIFEST_FILE = 'manifest.json'
const SAFE_ENGINE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
const SAFE_HOOK_FILE = /^[a-z0-9][a-z0-9_-]{0,63}\.ts$/

interface HookManifestEntry {
  engineId: string
  file: string
}

/** Copies each registered engine's self-contained rollback hook into `<runnerDir>/engine-hooks/`
 *  with a manifest so the frozen watchdog discovers and runs them without importing any engine by name. */
export async function freezeRollbackHooks(runnerDir: string, descriptors: readonly EngineRollbackDescriptor[]): Promise<void> {
  const dir = join(runnerDir, HOOKS_DIR)
  await mkdir(dir, { recursive: true })
  const entries: HookManifestEntry[] = []
  for (const descriptor of descriptors) {
    if (!SAFE_ENGINE_ID.test(descriptor.engineId)) throw new Error(`Invalid rollback hook engine id: ${descriptor.engineId}`)
    const file = `${descriptor.engineId}.ts`
    await cp(descriptor.modulePath, join(dir, file))
    entries.push({ engineId: descriptor.engineId, file })
  }
  await writeFile(join(dir, MANIFEST_FILE), `${JSON.stringify(entries, null, 2)}\n`)
}

/** Loads frozen engine rollback hooks from `<hooksDir>/manifest.json`. A single broken hook module
 *  returns a failing stub so other engines' rollback hooks still run. */
export async function loadRollbackHooks(hooksDir = join(import.meta.dir, HOOKS_DIR)): Promise<EngineRollbackHook[]> {
  const raw = JSON.parse(await readFile(join(hooksDir, MANIFEST_FILE), 'utf8')) as unknown
  if (!Array.isArray(raw)) throw new Error('Invalid rollback hook manifest')
  const hooks: EngineRollbackHook[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid rollback hook entry')
    const { engineId, file } = entry as Partial<HookManifestEntry>
    if (typeof engineId !== 'string' || !SAFE_ENGINE_ID.test(engineId) || typeof file !== 'string' || !SAFE_HOOK_FILE.test(file)) {
      throw new Error('Invalid rollback hook manifest entry')
    }
    try {
      const mod = (await import(join(hooksDir, file))) as { rollbackHook?: EngineRollbackHook }
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
 *  `Environment` (null when systemd could not say). Never throws: unreadable DB, missing manifest, or
 *  per-engine failures are counted, not fatal. */
export async function runEngineRollbacks(
  database: string,
  printed: string | null,
  options: { hooksDir?: string; hooks?: readonly EngineRollbackHook[] } = {}
): Promise<EngineRollbackResult> {
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
    hooks = options.hooks ?? (await loadRollbackHooks(options.hooksDir))
  } catch {
    return { cleared: 0, failed: totalProfiles || 1 }
  }
  const matchedProfiles = hooks.reduce((sum, hook) => sum + (profilesByEngine.get(hook.engineId)?.length ?? 0), 0)
  if (printed === null) return { cleared: 0, failed: matchedProfiles || 1 }
  const runCommand = (args: string[], timeoutMs = 30_000, env?: NodeJS.ProcessEnv) => command(args, undefined, timeoutMs, env)
  const result = { cleared: 0, failed: 0 }
  for (const hook of hooks) {
    const profiles = profilesByEngine.get(hook.engineId) ?? []
    if (!profiles.length) continue
    try {
      const outcome = await hook.rollback({ profiles, printedEnvironment: printed, runCommand })
      result.cleared += outcome.cleared
      result.failed += outcome.failed
    } catch {
      result.failed += profiles.length
    }
  }
  return result
}
