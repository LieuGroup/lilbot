import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearCheckpointFlags, rollbackProfiles, serviceEnvironment } from '../../server/deploy/rollback-profiles'

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
      "CREATE TABLE bots(engine_id TEXT, engine_bot_id TEXT, deletion TEXT); INSERT INTO bots VALUES ('hermes','dev-on',NULL),('hermes','dev-off',NULL),('hermes','dev-gone','{}'),('other','dev-x',NULL)"
    )
    db.close()
    const log = join(root, 'calls.log')
    const hermes = join(root, 'hermes')
    writeFileSync(hermes, `#!/bin/sh\necho "$HERMES_HOME $@" >> '${log}'\n[ "$2" = dev-on ] && [ "$4" = get ] && echo True\nexit 0\n`, { mode: 0o755 })
    const printed = `LILBOT_ENV=development HERMES_HOME=${dev.HERMES_HOME} LILBOT_HERMES_BIN=${hermes}`
    expect(await clearCheckpointFlags(database, printed)).toEqual({ cleared: 1, failed: 0 })
    expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
      `${dev.HERMES_HOME} -p dev-on config get compression.checkpoint_required`,
      `${dev.HERMES_HOME} -p dev-on config set compression.checkpoint_required false`,
      `${dev.HERMES_HOME} -p dev-off config get compression.checkpoint_required`
    ])
    expect(await clearCheckpointFlags(database, null)).toEqual({ cleared: 0, failed: 2 })
    expect(await clearCheckpointFlags(join(root, 'missing.db'), printed)).toEqual({ cleared: 0, failed: 1 })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
