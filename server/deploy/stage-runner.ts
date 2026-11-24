/** Atomically stages the frozen deploy runner and engine rollback hooks with private permissions (0700 dirs, 0600 files). */
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EngineRollbackDescriptor } from '../engines/engine-ops'
import { HOOKS_DIR, type HookManifestEntry, MANIFEST_FILE, SAFE_ENGINE_ID } from './rollback-profiles'

async function replaceDirAtomically(staging: string, target: string): Promise<void> {
  try {
    await rename(staging, target)
    return
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EEXIST' && code !== 'ENOTEMPTY' && code !== 'EISDIR') throw error
  }
  const backup = `${target}.prev.${process.pid}.${crypto.randomUUID().slice(0, 8)}`
  await rename(target, backup)
  try {
    await rename(staging, target)
  } catch (error) {
    await rename(backup, target).catch(() => {})
    throw error
  }
  await rm(backup, { recursive: true, force: true })
}

async function copyDirPrivate(sourceDir: string, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true, mode: 0o700 })
  await chmod(targetDir, 0o700)
  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    const src = join(sourceDir, entry.name)
    const dst = join(targetDir, entry.name)
    if (entry.isDirectory()) {
      await copyDirPrivate(src, dst)
    } else if (entry.isFile()) {
      const bytes = await readFile(src)
      await writeFile(dst, bytes, { mode: 0o600 })
      await chmod(dst, 0o600)
    }
  }
}

/** Stages each registered engine's self-contained rollback hook into a 0700 temp directory with 0600 files
 *  and atomically renames it into `<runnerDir>/engine-hooks/`. */
export async function freezeRollbackHooks(runnerDir: string, descriptors: readonly EngineRollbackDescriptor[]): Promise<void> {
  if (descriptors.length === 0) throw new Error('At least one engine rollback hook is required')
  const seen = new Set<string>()
  for (const descriptor of descriptors) {
    if (!SAFE_ENGINE_ID.test(descriptor.engineId) || seen.has(descriptor.engineId)) throw new Error(`Invalid rollback hook engine id: ${descriptor.engineId}`)
    seen.add(descriptor.engineId)
  }
  await mkdir(runnerDir, { recursive: true, mode: 0o700 })
  const staging = join(runnerDir, `.${HOOKS_DIR}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`)
  try {
    await mkdir(staging, { recursive: true, mode: 0o700 })
    await chmod(staging, 0o700)
    const entries: HookManifestEntry[] = []
    for (const descriptor of descriptors) {
      const file = `${descriptor.engineId}.ts`
      const bytes = await readFile(descriptor.modulePath)
      const dest = join(staging, file)
      await writeFile(dest, bytes, { mode: 0o600 })
      await chmod(dest, 0o600)
      entries.push({ engineId: descriptor.engineId, file })
    }
    const manifestPath = join(staging, MANIFEST_FILE)
    await writeFile(manifestPath, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 })
    await chmod(manifestPath, 0o600)
    await replaceDirAtomically(staging, join(runnerDir, HOOKS_DIR))
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

/** Stages the frozen deploy runner and its engine rollback hooks in a 0700 temp directory (0600 files)
 *  and atomically moves it into `<deployRoot>/runner`. */
export async function stageDeployRunner(deployRoot: string, sourceDir: string, descriptors: readonly EngineRollbackDescriptor[]): Promise<void> {
  await mkdir(deployRoot, { recursive: true, mode: 0o700 })
  await chmod(deployRoot, 0o700)
  const staging = join(deployRoot, `.runner.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`)
  try {
    await copyDirPrivate(sourceDir, staging)
    await freezeRollbackHooks(staging, descriptors)
    await replaceDirAtomically(staging, join(deployRoot, 'runner'))
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}
