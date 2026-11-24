import '../scripts/dev-env'
/** Real systemd restarts, never the live LilBot unit, checkout, data or tunnel. One temporary `dev-` profile, deleted at the end. */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { mkdir, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { git, systemctl } from '../server/deploy/process'
import { deleteProfile } from './check-process'
import { DeployFixture } from './deploy-fixture'

async function within<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('App notice timed out')), 5_000)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

const f = new DeployFixture()
// A bound bot whose profile is fail-closed (#148): the rollback must clear the flag before the previous release starts.
const profile = `dev-rollback-${crypto.randomUUID().slice(0, 8)}`
const hermes = (...args: string[]) => {
  const done = Bun.spawnSync([process.env.LILBOT_HERMES_BIN ?? 'hermes', ...args], { env: process.env })
  assert.equal(done.exitCode, 0, `hermes ${args.slice(0, 3).join(' ')}`)
  return done.stdout.toString().trim()
}
try {
  await f.setup()
  // Bootstrap and subsequent deployments use the same public command. This external gate lets the
  // final scenario fail both revisions without changing any already-verified source files.
  const startup = await f.read('server/main.ts')
  await f.edit(
    'server/deploy/check-gate.ts',
    "import { join } from 'node:path'\n\nexport async function checkStart(dataDir: string) {\n  if (await Bun.file(join(dataDir, 'fail-all-starts')).exists()) throw new Error('rollback-check failure')\n}\n"
  )
  const gated = startup
    .replace("import { deployNotice } from './deploy/deploy-notice'", "import { checkStart } from './deploy/check-gate'\nimport { deployNotice } from './deploy/deploy-notice'")
    .replace(
      "/** LilBot's own database file lives here. */\nconst DATA_DIR = process.env.LILBOT_DATA_DIR ?? join(homedir(), '.local', 'share', 'lilbot')\n/** Each bot's workspace folder is created under here. */",
      "const DATA_DIR = process.env.LILBOT_DATA_DIR ?? join(homedir(), '.local', 'share', 'lilbot')\nawait checkStart(DATA_DIR)"
    )
  assert.notEqual(gated, startup, 'the start-up lines deploy-check gates have moved')
  await f.edit('server/main.ts', gated)
  await f.commit('test: isolated startup failure gate')
  const good = await git(f.checkout, 'rev-parse', 'HEAD')
  await f.refuse('verify on this exact clean commit')
  await f.verify()
  assert.equal((await f.deploy(0, true)).status, 'healthy')
  await f.edit('deploy-check-marker.txt', 'uncommitted work')
  await f.refuse('dirty checkout')
  await rm(join(f.checkout, 'deploy-check-marker.txt'))
  await mkdir(join(f.data, 'deploy/lock'), { recursive: true })
  await f.refuse('Deployment locked')
  await rm(join(f.data, 'deploy/lock'), { recursive: true })
  assert.equal((await f.deploy(0)).status, 'healthy')
  assert.equal(await git(f.checkout, 'rev-parse', 'HEAD'), good)
  console.log('ok: healthy commit stays, independent watchdog exits, no rollback')

  const db = new Database(join(f.data, 'lilbot.db'))
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec("PRAGMA wal_autocheckpoint=0; CREATE TABLE deployment_marker(value TEXT); INSERT INTO deployment_marker VALUES ('before deploy')")
  hermes('profile', 'create', profile)
  hermes('-p', profile, 'config', 'set', 'compression.checkpoint_required', 'true')
  db.query("INSERT INTO bots(id, name, function, instructions, engine_id, engine_bot_id) VALUES ('rollback-check', 'Rollback check', '', '', 'hermes', ?)").run(profile)
  db.close()
  const key = await readFile(join(f.data, 'computer-server-key.pem'), 'utf8')
  assert.equal(await Bun.file(join(f.link, '.git')).exists(), false, 'Releases must be clean exports, not working trees')
  // Typechecks and tests pass; actual startup fails after a schema/data change.
  await f.edit(
    'server/deploy/check-gate.ts',
    "import { Database } from 'bun:sqlite'\nimport { join } from 'node:path'\n\nexport async function checkStart(dataDir: string) {\n  if (await Bun.file(join(dataDir, 'fail-all-starts')).exists()) throw new Error('rollback-check failure')\n  if (process.env.LILBOT_DATA_DIR) {\n    new Database(join(dataDir, 'lilbot.db')).exec(\"INSERT INTO deployment_marker VALUES ('failed version'); PRAGMA user_version=999\")\n    throw new Error('deploy-check deliberate startup failure; password=do-not-record-me')\n  }\n}\n"
  )
  const broken = await f.commit('test: deliberately broken startup')
  await f.verify()
  const started = Date.now()
  const rolled = await f.deploy(1)
  assert.equal(rolled.status, 'rolled-back')
  assert.equal(rolled.commit, broken)
  assert.equal(rolled.previous, good)
  assert.ok(Date.now() - started >= 60_000 && Date.now() - started < 110_000, 'Rollback should begin at 60 seconds and finish promptly')
  assert.equal(await git(f.checkout, 'rev-parse', 'HEAD'), broken, 'Rollback must never change the source checkout')
  assert.equal(await realpath(f.link), join(f.releases, good))
  assert.equal(rolled.logs?.includes('do-not-record-me'), false)
  assert.ok(rolled.logs?.includes('[rollback] memory save flag cleared for 1 bots'), 'the rollback did not clear the memory save flag')
  assert.equal(hermes('-p', profile, 'config', 'get', 'compression.checkpoint_required').toLowerCase(), 'false')
  assert.ok(rolled.logs?.includes('deliberate startup failure') || rolled.logs?.includes('newer LilBot'))
  const restored = new Database(join(f.data, 'lilbot.db'))
  restored.exec('PRAGMA busy_timeout = 5000')
  assert.deepEqual(restored.query('SELECT * FROM deployment_marker').all(), [{ value: 'before deploy' }])
  restored.close()
  assert.equal(await readFile(join(f.data, 'computer-server-key.pem'), 'utf8'), key)
  assert.equal((await stat(join(f.data, 'deploy/notice.json'))).mode & 0o777, 0o600)
  assert.equal((await stat(join(f.data, 'deploy/runner'))).mode & 0o777, 0o700)
  assert.equal((await stat(join(f.data, 'deploy/runner/engine-hooks'))).mode & 0o777, 0o700)
  assert.equal((await stat(join(f.data, 'deploy/runner/engine-hooks/manifest.json'))).mode & 0o777, 0o600)
  assert.equal((await stat(join(f.data, 'deploy/runner/engine-hooks/hermes.ts'))).mode & 0o777, 0o600)
  const socket = new WebSocket(`ws://127.0.0.1:${f.port}/ws`)
  try {
    await within(
      new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve()
        socket.onerror = reject
      })
    )
    const notice = new Promise<any>(resolve => {
      socket.onmessage = e => resolve(JSON.parse(e.data))
    })
    socket.send(JSON.stringify({ id: 1, method: 'deploy.status', params: {} }))
    assert.ok((await within(notice)).result.notice.includes(broken.slice(0, 12)))
  } finally {
    socket.close()
  }
  console.log('ok: broken commit rolls back in about a minute; WAL marker and key survive; app notice and masked record persisted; memory save flag cleared')

  // Reuse the exact broken commit that passed verification above. The last running good
  // revision only encounters this external failure on restart, so recovery fails as well.
  await writeFile(join(f.data, 'fail-all-starts'), 'fail next startup')
  const failed = await f.deploy(1)
  assert.equal(failed.status, 'manual-recovery')
  assert.equal(await git(f.checkout, 'rev-parse', 'HEAD'), broken)
  assert.equal(await realpath(f.link), join(f.releases, good))
  assert.equal(await systemctl('show', f.unit, '-p', 'MainPID', '--value'), '0')
  assert.ok(['inactive', 'failed'].includes(await systemctl('show', f.unit, '-p', 'ActiveState', '--value')))
  assert.ok((await stat(join(f.data, 'deploy/lock'))).isDirectory())
  assert.equal((await readdir(join(f.data, 'deploy/backups'))).length, 3)
  await Bun.sleep(2_000)
  assert.equal(await systemctl('show', f.unit, '-p', 'MainPID', '--value'), '0')
  assert.ok(['inactive', 'failed'].includes(await systemctl('show', f.unit, '-p', 'ActiveState', '--value')))
  console.log('ok: failed rollback stops permanently with three backups, record and lock for manual recovery')
} finally {
  await f.cleanup()
  await deleteProfile(profile, 'ignore').exited
  assert.ok(!hermes('profile', 'list').includes(profile), 'the temporary profile remains')
  console.log('cleaned: temporary units, directories and the temporary profile removed')
}
