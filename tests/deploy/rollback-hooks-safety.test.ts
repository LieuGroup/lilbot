import { Database } from 'bun:sqlite'
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadRollbackHooks, runEngineRollbacks } from '../../server/deploy/rollback-profiles'
import { freezeRollbackHooks, stageDeployRunner } from '../../server/deploy/stage-runner'
import type { EngineRollbackHook } from '../../server/engines/engine-ops'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}
function makeDb(root: string, rows: [string, string, string][]) {
  const path = join(root, 'lilbot.db')
  const db = new Database(path)
  db.exec('CREATE TABLE bots(id TEXT, engine_id TEXT, engine_bot_id TEXT, deletion TEXT)')
  const insert = db.prepare('INSERT INTO bots VALUES (?, ?, ?, NULL)')
  for (const [id, engineId, botId] of rows) insert.run(id, engineId, botId)
  db.close()
  return path
}

test('freezeRollbackHooks rejects unsafe or duplicate engine ids and empty descriptor lists', async () => {
  const root = tempDir('lilbot-freeze-guard-')
  const src = join(root, 'hook.ts')
  writeFileSync(src, 'export const rollbackHook = { engineId: "ok", async rollback() { return { cleared: 0, failed: 0 } } }\n')
  await expect(freezeRollbackHooks(join(root, 'r0'), [])).rejects.toThrow('At least one')
  for (const badId of ['', '../evil', 'BadId', 'a/b', 'a b']) {
    await expect(freezeRollbackHooks(join(root, 'r1'), [{ engineId: badId, modulePath: src }])).rejects.toThrow('Invalid rollback hook engine id')
  }
  await expect(
    freezeRollbackHooks(join(root, 'r2'), [
      { engineId: 'dup', modulePath: src },
      { engineId: 'dup', modulePath: src }
    ])
  ).rejects.toThrow('Invalid rollback hook engine id')
})

test('loadRollbackHooks rejects empty, unsafe, duplicate, or path-escaping manifest entries and replaces mismatched hook ids with failing stubs', async () => {
  const root = tempDir('lilbot-load-guard-')
  const writeManifest = (name: string, content: unknown) => {
    const dir = join(root, name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(content))
    return dir
  }
  await expect(loadRollbackHooks(writeManifest('empty', []))).rejects.toThrow('empty rollback hook manifest')
  await expect(loadRollbackHooks(writeManifest('bad-id', [{ engineId: '../evil', file: 'evil.ts' }]))).rejects.toThrow('Invalid rollback hook manifest entry')
  await expect(loadRollbackHooks(writeManifest('bad-file-path', [{ engineId: 'ok', file: '../escape.ts' }]))).rejects.toThrow('Invalid rollback hook manifest entry')
  await expect(loadRollbackHooks(writeManifest('bad-file-ext', [{ engineId: 'ok', file: 'ok.js' }]))).rejects.toThrow('Invalid rollback hook manifest entry')
  await expect(
    loadRollbackHooks(
      writeManifest('dup', [
        { engineId: 'ok', file: 'ok.ts' },
        { engineId: 'ok', file: 'ok.ts' }
      ])
    )
  ).rejects.toThrow('Duplicate rollback hook entry')

  // Module exporting a hook with a mismatched engineId becomes a failing stub instead of running under the wrong engine.
  const mismatchDir = writeManifest('mismatch', [{ engineId: 'expected-eng', file: 'expected-eng.ts' }])
  writeFileSync(join(mismatchDir, 'expected-eng.ts'), 'export const rollbackHook = { engineId: "wrong-eng", async rollback() { return { cleared: 99, failed: 0 } } }\n')
  const loadedMismatch = await loadRollbackHooks(mismatchDir)
  expect(loadedMismatch.map(h => h.engineId)).toEqual(['expected-eng'])
  const db = makeDb(root, [
    ['b1', 'expected-eng', 'p1'],
    ['b2', 'wrong-eng', 'p2']
  ])
  expect(await runEngineRollbacks(db, 'LILBOT_ENV=production', { hooksDir: mismatchDir })).toEqual({ cleared: 0, failed: 2 })
})

test('runEngineRollbacks fails closed on null printedEnvironment without calling hooks, on empty manifest, and on unmatched engines', async () => {
  const root = tempDir('lilbot-null-empty-')
  let called = false
  const spyHook: EngineRollbackHook = {
    engineId: 'eng-a',
    async rollback() {
      called = true
      return { cleared: 1, failed: 0 }
    }
  }
  const dbWithBots = makeDb(root, [
    ['b1', 'eng-a', 'p1'],
    ['b2', 'eng-b', 'p2'],
    ['b3', 'eng-b', 'p3']
  ])
  expect(await runEngineRollbacks(dbWithBots, null, { hooks: [spyHook] })).toEqual({ cleared: 0, failed: 3 })
  expect(called).toBe(false)
  const emptySub = join(root, 'sub')
  mkdirSync(emptySub)
  const emptyDb = makeDb(emptySub, [])
  expect(await runEngineRollbacks(emptyDb, null, { hooks: [spyHook] })).toEqual({ cleared: 0, failed: 1 })
  expect(await runEngineRollbacks(dbWithBots, 'LILBOT_ENV=production', { hooks: [] })).toEqual({ cleared: 0, failed: 3 })
  expect(await runEngineRollbacks(emptyDb, 'LILBOT_ENV=production', { hooks: [] })).toEqual({ cleared: 0, failed: 1 })

  // Empty manifest on disk counts all non-deleted bots as failures (or 1 when DB has no bots).
  const emptyHooks = join(root, 'empty-hooks')
  mkdirSync(emptyHooks, { recursive: true })
  writeFileSync(join(emptyHooks, 'manifest.json'), '[]\n')
  expect(await runEngineRollbacks(dbWithBots, 'LILBOT_ENV=production', { hooksDir: emptyHooks })).toEqual({ cleared: 0, failed: 3 })
  expect(await runEngineRollbacks(emptyDb, 'LILBOT_ENV=production', { hooksDir: emptyHooks })).toEqual({ cleared: 0, failed: 1 })

  // Unmatched engine bots are counted as failed while matched engines still clear.
  expect(await runEngineRollbacks(dbWithBots, 'LILBOT_ENV=production', { hooks: [spyHook] })).toEqual({ cleared: 1, failed: 2 })
})

test('hanging hooks time out without blocking other engines, and malformed or throwing hook results never produce NaN', async () => {
  const root = tempDir('lilbot-timeout-malformed-')
  const db = makeDb(root, [
    ['b1', 'hanging', 'p1'],
    ['b2', 'healthy', 'p2'],
    ['b3', 'malformed-empty', 'p3'],
    ['b4', 'malformed-nan', 'p4'],
    ['b5', 'malformed-neg', 'p5'],
    ['b6', 'sync-throw', 'p6']
  ])
  const hooks: EngineRollbackHook[] = [
    { engineId: 'hanging', rollback: () => new Promise(() => {}) },
    { engineId: 'healthy', rollback: async ({ profiles }) => ({ cleared: profiles.length, failed: 0 }) },
    { engineId: 'malformed-empty', rollback: (async () => ({}) as any) as EngineRollbackHook['rollback'] },
    { engineId: 'malformed-nan', rollback: async () => ({ cleared: Number.NaN, failed: 0 }) },
    { engineId: 'malformed-neg', rollback: async () => ({ cleared: -1, failed: 0 }) },
    {
      engineId: 'sync-throw',
      rollback: () => {
        throw new Error('sync boom')
      }
    }
  ]
  const started = Date.now()
  const outcome = await runEngineRollbacks(db, 'LILBOT_ENV=production', { hooks, hookTimeoutMs: 50 })
  expect(Date.now() - started).toBeLessThan(2_000)
  expect(outcome).toEqual({ cleared: 1, failed: 5 })
  expect(Number.isNaN(outcome.cleared) || Number.isNaN(outcome.failed)).toBe(false)
})

test('aggregate rollback budget caps total runtime across multiple hanging hooks and skips hooks once exhausted', async () => {
  const root = tempDir('lilbot-total-budget-')
  const db = makeDb(root, [
    ['b1', 'eng-1', 'p1'],
    ['b2', 'eng-2', 'p2'],
    ['b3', 'eng-3', 'p3']
  ])
  const startedHooks: string[] = []
  const hanging = (engineId: string): EngineRollbackHook => ({
    engineId,
    rollback: () => {
      startedHooks.push(engineId)
      return new Promise(() => {})
    }
  })
  const started = Date.now()
  const outcome = await runEngineRollbacks(db, 'LILBOT_ENV=production', {
    hooks: [hanging('eng-1'), hanging('eng-2'), hanging('eng-3')],
    hookTimeoutMs: 90,
    totalTimeoutMs: 120
  })
  expect(outcome).toEqual({ cleared: 0, failed: 3 })
  expect(Date.now() - started).toBeLessThan(240)
  expect(startedHooks).toEqual(['eng-1', 'eng-2'])
  expect(
    readFileSync(join(import.meta.dir, '../../server/deploy/watchdog.ts'), 'utf8')
      .trim()
      .endsWith('process.exit(process.exitCode ?? 0)')
  ).toBe(true)
})

test('stageDeployRunner and freezeRollbackHooks stage atomically with 0700 dirs, 0600 files, and preserve prior state on failure', async () => {
  const root = tempDir('lilbot-stage-perms-')
  const srcDeploy = join(root, 'src-deploy')
  mkdirSync(srcDeploy, { recursive: true, mode: 0o755 })
  writeFileSync(join(srcDeploy, 'watchdog.ts'), '// watchdog\n', { mode: 0o644 })
  const hookSrc = join(root, 'eng-rollback.ts')
  writeFileSync(hookSrc, 'export const rollbackHook = { engineId: "eng", async rollback() { return { cleared: 0, failed: 0 } } }\n', { mode: 0o644 })

  const deployRoot = join(root, 'deploy')
  await stageDeployRunner(deployRoot, srcDeploy, [{ engineId: 'eng', modulePath: hookSrc }])

  const runnerDir = join(deployRoot, 'runner')
  const hooksDir = join(runnerDir, 'engine-hooks')
  expect(statSync(deployRoot).mode & 0o777).toBe(0o700)
  expect(statSync(runnerDir).mode & 0o777).toBe(0o700)
  expect(statSync(join(runnerDir, 'watchdog.ts')).mode & 0o777).toBe(0o600)
  expect(statSync(hooksDir).mode & 0o777).toBe(0o700)
  expect(statSync(join(hooksDir, 'manifest.json')).mode & 0o777).toBe(0o600)
  expect(statSync(join(hooksDir, 'eng.ts')).mode & 0o777).toBe(0o600)
  expect(readdirSync(deployRoot)).toEqual(['runner'])
  expect(readdirSync(runnerDir).sort()).toEqual(['engine-hooks', 'watchdog.ts'])

  // A failed re-freeze cleans up its temp directory and leaves the previous hooks intact.
  await expect(freezeRollbackHooks(runnerDir, [{ engineId: 'eng', modulePath: join(root, 'does-not-exist.ts') }])).rejects.toThrow()
  expect(readdirSync(runnerDir).sort()).toEqual(['engine-hooks', 'watchdog.ts'])
  expect(readFileSync(join(hooksDir, 'eng.ts'), 'utf8')).toContain('engineId: "eng"')
})
