import '../scripts/dev-env'
/** Real systemd restarts, never the live LilBot unit, checkout, data or tunnel. No profiles created. */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { mkdir, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { git, systemctl } from '../server/deploy/process'
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
try {
  await f.setup()
  // Bootstrap and subsequent deployments use the same public command. This external gate lets the
  // final scenario fail both revisions without changing any already-verified source files.
  const startup = await f.read('server/main.ts')
  await f.edit(
    'server/main.ts',
    startup.replace(
      'const COMMIT =',
      "if (await Bun.file(join(process.env.LILBOT_DATA_DIR ?? '', 'fail-all-starts')).exists()) throw new Error('rollback-check failure')\nconst COMMIT ="
    )
  )
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
  db.close()
  const key = await readFile(join(f.data, 'computer-server-key.pem'), 'utf8')
  const main = await f.read('server/main.ts')
  assert.equal(await Bun.file(join(f.link, '.git')).exists(), false, 'Releases must be clean exports, not working trees')
  // Typechecks and tests pass; actual startup fails after a schema/data change.
  await f.edit(
    'server/main.ts',
    main.replace(
      'const activity = new ActivityService',
      "if (process.env.LILBOT_DATA_DIR) {\ndatabase.exec(\"INSERT INTO deployment_marker VALUES ('failed version'); PRAGMA user_version=999\")\nthrow new Error('deploy-check deliberate startup failure; password=do-not-record-me')\n}\nconst activity = new ActivityService"
    )
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
  assert.ok(rolled.logs?.includes('deliberate startup failure') || rolled.logs?.includes('newer LilBot'))
  const restored = new Database(join(f.data, 'lilbot.db'))
  restored.exec('PRAGMA busy_timeout = 5000')
  assert.deepEqual(restored.query('SELECT * FROM deployment_marker').all(), [{ value: 'before deploy' }])
  restored.close()
  assert.equal(await readFile(join(f.data, 'computer-server-key.pem'), 'utf8'), key)
  assert.equal((await stat(join(f.data, 'deploy/notice.json'))).mode & 0o777, 0o600)
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
  console.log('ok: broken commit rolls back in about a minute; WAL marker and key survive; app notice and masked record persisted')

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
  console.log('cleaned: temporary units and directories removed; no Hermes profiles created')
}
