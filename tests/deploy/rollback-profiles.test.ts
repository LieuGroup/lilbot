import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freezeRollbackHooks, loadRollbackHooks, runEngineRollbacks } from '../../server/deploy/rollback-profiles'
import { rollbackHook as hermesRollbackHook, rollbackProfiles, serviceEnvironment } from '../../server/engines/hermes/hermes-rollback'
import { registeredEngineRollbackHooks } from '../../server/engines/registry'

const dev = { LILBOT_ENV: 'development', HERMES_HOME: '/home/u/lilbot-dev/hermes' }

test("the service's own Hermes settings are read from its unit, nothing else", () => {
  expect(
    serviceEnvironment('LILBOT_ENV=development "HERMES_HOME=/home/u/lilbot-dev/hermes" LILBOT_ACCESS_EMAIL=x@y PATH=/usr/bin "LILBOT_HERMES_BIN=/opt/my \\"hermes\\""')
  ).toEqual({
    LILBOT_ENV: 'development',
    HERMES_HOME: '/home/u/lilbot-dev/hermes',
    PATH: '/usr/bin',
    LILBOT_HERMES_BIN: '/opt/my "hermes"'
  })
})

test('development touches only dev- profiles under the development home; production never touches them', () => {
  const ids = ['default', 'dev-a', 'chief', 'dev-a', 'Bad id', '../x']
  expect(rollbackProfiles(ids, dev)).toEqual([['-p', 'dev-a']])
  expect(rollbackProfiles(ids, { ...dev, HERMES_HOME: '/home/u/.hermes' })).toEqual([])
  expect(rollbackProfiles(ids, { LILBOT_ENV: 'development' })).toEqual([])
  expect(rollbackProfiles(ids, {})).toEqual([[], ['-p', 'chief']])
})

test('a rollback clears the flag only where it is set, for bound bots that are not deleted', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lilbot-rollback-'))
  try {
    const database = join(root, 'lilbot.db')
    const db = new Database(database)
    db.exec(
      "CREATE TABLE bots(id TEXT, engine_id TEXT, engine_bot_id TEXT, deletion TEXT); INSERT INTO bots VALUES ('lilbot-1','hermes','dev-on',NULL),('lilbot-2','hermes','dev-off',NULL),('lilbot-3','hermes','dev-gone','{}'),('lilbot-4','other','dev-x',NULL)"
    )
    db.close()
    const log = join(root, 'calls.log')
    const hermes = join(root, 'hermes')
    writeFileSync(hermes, `#!/bin/sh\necho "$HERMES_HOME $@" >> '${log}'\n[ "$2" = dev-on ] && [ "$4" = get ] && echo "Hermes notice: a banner" && echo True\nexit 0\n`, {
      mode: 0o755
    })
    const printed = `LILBOT_ENV=development HERMES_HOME=${dev.HERMES_HOME} LILBOT_HERMES_BIN=${hermes}`
    expect(await runEngineRollbacks(database, printed, { hooks: [hermesRollbackHook] })).toEqual({ cleared: 1, failed: 0 })
    expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
      `${dev.HERMES_HOME} -p dev-on config get compression.checkpoint_required`,
      `${dev.HERMES_HOME} -p dev-on config set compression.checkpoint_required false`,
      `${dev.HERMES_HOME} -p dev-off config get compression.checkpoint_required`
    ])
    expect(await runEngineRollbacks(database, null, { hooks: [hermesRollbackHook] })).toEqual({ cleared: 0, failed: 2 })
    expect(await runEngineRollbacks(join(root, 'missing.db'), printed, { hooks: [hermesRollbackHook] })).toEqual({ cleared: 0, failed: 1 })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('frozen runner discovers and runs every registered engine hook from manifest without a running registry', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lilbot-frozen-hooks-'))
  try {
    const runnerDir = join(root, 'runner')
    const secondHookSrc = join(root, 'second-rollback.ts')
    const marker = join(root, 'second-ran.json')
    writeFileSync(
      secondHookSrc,
      `import { writeFileSync } from 'node:fs'
export const rollbackHook = {
  engineId: 'second',
  async rollback(context: { profiles: readonly string[] }) {
    writeFileSync(${JSON.stringify(marker)}, JSON.stringify(context.profiles))
    return { cleared: context.profiles.length, failed: 0 }
  }
}
`
    )
    await freezeRollbackHooks(runnerDir, [...registeredEngineRollbackHooks(), { engineId: 'second', modulePath: secondHookSrc }])

    const database = join(root, 'lilbot.db')
    const db = new Database(database)
    db.exec(
      "CREATE TABLE bots(id TEXT, engine_id TEXT, engine_bot_id TEXT, deletion TEXT); INSERT INTO bots VALUES ('b1','hermes','dev-on',NULL),('b2','second','sec-1',NULL),('b3','second','sec-gone','{}')"
    )
    db.close()

    const hermes = join(root, 'hermes')
    writeFileSync(hermes, '#!/bin/sh\n[ "$2" = dev-on ] && [ "$4" = get ] && echo True\nexit 0\n', { mode: 0o755 })
    const printed = `LILBOT_ENV=development HERMES_HOME=${dev.HERMES_HOME} LILBOT_HERMES_BIN=${hermes}`
    const hooksDir = join(runnerDir, 'engine-hooks')
    expect(await runEngineRollbacks(database, printed, { hooksDir })).toEqual({ cleared: 2, failed: 0 })
    expect(JSON.parse(readFileSync(marker, 'utf8'))).toEqual(['sec-1'])

    // Missing manifest counts failures without throwing; one broken hook module does not block healthy hooks.
    expect(await runEngineRollbacks(database, printed, { hooksDir: join(root, 'missing-hooks') })).toEqual({ cleared: 0, failed: 2 })
    writeFileSync(join(hooksDir, 'broken.ts'), 'export const rollbackHook = null\n')
    writeFileSync(
      join(hooksDir, 'manifest.json'),
      JSON.stringify([
        { engineId: 'broken', file: 'broken.ts' },
        { engineId: 'second', file: 'second.ts' }
      ])
    )
    const db2 = new Database(database)
    db2.exec("INSERT INTO bots VALUES ('b4','broken','br-1',NULL)")
    db2.close()
    const loaded = await loadRollbackHooks(hooksDir)
    expect(loaded.map(h => h.engineId)).toEqual(['broken', 'second'])
    expect(await runEngineRollbacks(database, printed, { hooksDir })).toEqual({ cleared: 1, failed: 1 })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('registered engine rollback hook files keep zero runtime relative imports so they stay self-contained when frozen', () => {
  for (const descriptor of registeredEngineRollbackHooks()) {
    const source = readFileSync(descriptor.modulePath, 'utf8')
    const runtimeRelative = source.split('\n').filter(line => /^\s*import\s+(?!type\b)/.test(line) && /['"]\.\.?\//.test(line))
    expect(runtimeRelative, descriptor.modulePath).toEqual([])
  }
})
