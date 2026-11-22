import { cp, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Deployment } from './deploy-state'
import { readJson, writeJson } from './files'
import { health } from './health'
import { runMaintenance } from './maintenance'
import { cleanHead, git, systemctl } from './process'
import { buildRelease, currentRelease, pruneReleases, releaseCommit } from './releases'

const checkout = await realpath(process.cwd())
const dataDir = resolve(process.env.LILBOT_DATA_DIR ?? join(homedir(), '.local/share/lilbot'))
const root = join(dataDir, 'deploy')
const releaseRoot = resolve(process.env.LILBOT_RELEASES_DIR ?? join(homedir(), 'lilbot/releases'))
const releaseLink = resolve(process.env.LILBOT_RELEASE_LINK ?? join(homedir(), 'lilbot/release'))
const bootstrap = process.argv.includes('--bootstrap')
const unit = process.env.LILBOT_DEPLOY_UNIT ?? 'lilbot.service'
const watchdogUnit = process.env.LILBOT_DEPLOY_WATCHDOG_UNIT ?? 'lilbot-deploy.service'
const healthUrl = process.env.LILBOT_DEPLOY_HEALTH_URL ?? 'http://127.0.0.1:3370/api/health'
try {
  if (process.argv.includes('--status')) {
    const job = await readJson<Deployment>(join(root, 'job.json'))
    console.log(JSON.stringify(job, null, 2))
    process.exit(job.status === 'healthy' ? 0 : 1)
  }
  const maintenanceIdx = process.argv.indexOf('--maintenance')
  if (maintenanceIdx >= 0) {
    const action = process.argv[maintenanceIdx + 1]
    if (action !== 'stop' && action !== 'start') throw new Error('Usage: bun run deploy --maintenance <stop|start>')
    if (!/^[a-zA-Z0-9_.@-]+\.service$/.test(unit)) throw new Error('Invalid service name')
    const url = new URL(healthUrl)
    if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw new Error('Health URL must use HTTP on 127.0.0.1')
    console.log(JSON.stringify(await runMaintenance(action, { dataDir, releaseLink, releaseRoot, unit, healthUrl }), null, 2))
    process.exit(0)
  }
  if (!/^[a-zA-Z0-9_.@-]+\.service$/.test(unit) || !/^[a-zA-Z0-9_.@-]+\.service$/.test(watchdogUnit) || unit === watchdogUnit) throw new Error('Invalid service names')
  const url = new URL(healthUrl)
  if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw new Error('Health URL must use HTTP on 127.0.0.1')
  const commit = await cleanHead(checkout)
  const marker = resolve(checkout, await git(checkout, 'rev-parse', '--git-path', 'lilbot-verified.json'))
  if ((await readJson<{ commit: string }>(marker).catch(() => undefined))?.commit !== commit) throw new Error('Run bun run verify on this exact clean commit before deploying.')
  if ((await systemctl('show', unit, '--property=WorkingDirectory', '--value')) !== releaseLink) throw new Error('Service WorkingDirectory must point to the release symlink.')
  const start = await systemctl('show', unit, '--property=ExecStart', '--value')
  if (!start.includes(join(releaseLink, 'server/main.ts'))) throw new Error('Service ExecStart must point to the release symlink.')
  await mkdir(releaseRoot, { recursive: true })
  const previousRelease = await currentRelease(releaseLink, releaseRoot)
  if (bootstrap !== !previousRelease) throw new Error('Use --bootstrap only for the first release; normal deploys need an existing release.')
  const running = await health(healthUrl)
  const previous = previousRelease ? await releaseCommit(previousRelease) : undefined
  if (!bootstrap && running?.commit !== previous) throw new Error('The running service does not match the current release.')
  const pid = await systemctl('show', unit, '--property=MainPID', '--value')
  if (!bootstrap && (Number(pid) !== running?.pid || Number(pid) < 1)) throw new Error('Health endpoint does not belong to the target service.')
  if (Number(pid) > 0) {
    const environment = (await readFile(`/proc/${pid}/environ`, 'utf8')).split('\0')
    const serviceData = environment.find(value => value.startsWith('LILBOT_DATA_DIR='))?.slice('LILBOT_DATA_DIR='.length) ?? join(homedir(), '.local/share/lilbot')
    if ((await realpath(serviceData)) !== (await realpath(dataDir))) throw new Error('Data directory does not match the running service.')
  }
  const watchdogCommand = await systemctl('show', watchdogUnit, '--property=ExecStart', '--value')
  if (!watchdogCommand.includes(join(root, 'runner/watchdog.ts')) || !watchdogCommand.includes(join(root, 'job.json')))
    throw new Error('Install a watchdog unit pointing to this data directory before deploying.')
  await mkdir(root, { recursive: true, mode: 0o700 })
  await mkdir(join(root, 'lock'), { mode: 0o700 }).catch(() => {
    throw new Error('Deployment locked. Read deploy/job.json; recover manually before removing the lock.')
  })
  let handedOff = false
  try {
    await rm(join(root, 'runner'), { recursive: true, force: true })
    await cp(import.meta.dir, join(root, 'runner'), { recursive: true })
    const release = await buildRelease(checkout, releaseRoot, commit)
    await pruneReleases(releaseRoot, [release, ...(previousRelease ? [previousRelease] : [])])
    if ((await cleanHead(checkout)) !== commit) throw new Error('Source checkout changed during the release build.')
    const job: Deployment = {
      id: crypto.randomUUID(),
      releaseRoot,
      releaseLink,
      release,
      previousRelease,
      dataDir,
      unit,
      watchdogUnit,
      healthUrl,
      previous,
      commit,
      startedAt: new Date().toISOString(),
      status: 'pending'
    }
    await writeJson(join(root, 'job.json'), job)
    // An installed but never-started unit may be unloaded; reset-failed then returns 1.
    // Starting it below is the authoritative check.
    await systemctl('reset-failed', watchdogUnit).catch(() => {})
    await systemctl('start', '--no-block', watchdogUnit)
    handedOff = true
    console.log(`Deployment ${job.id} is owned by ${watchdogUnit}. On reconnect: bun run deploy --status`)
    const deadline = Date.now() + 8 * 60_000
    while (Date.now() < deadline) {
      const result = await readJson<Deployment>(join(root, 'job.json'))
      if (result.finishedAt) {
        console.log(JSON.stringify(result, null, 2))
        process.exitCode = result.status === 'healthy' ? 0 : 1
        break
      }
      await Bun.sleep(500)
    }
    if (process.exitCode === undefined) throw new Error('Watchdog still owns deployment; inspect its unit and deploy/job.json. Do not redeploy.')
  } finally {
    if (!handedOff) await rm(join(root, 'lock'), { recursive: true, force: true })
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Deployment failed')
  process.exitCode = 1
}
