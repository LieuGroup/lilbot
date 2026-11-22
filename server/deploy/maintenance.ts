/** Maintenance stop/start owned by `bun run deploy`, holding `<data>/deploy/lock/` for offline maintenance (such as bot re-keying). */
import { mkdir, readFile, realpath, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { readJson, writeJson } from './files'
import { health } from './health'
import { systemctl } from './process'
import { currentRelease, releaseCommit } from './releases'

export const MAINTENANCE_LOCK_FILE = 'maintenance.json'

export interface MaintenanceLock {
  startedAt: string
  unit: string
  watchdogUnit?: string
  dataDir: string
}

interface MaintenanceOps {
  systemctl?: (...args: string[]) => Promise<string>
  health?: (url: string) => Promise<{ ok: boolean; commit: string; pid: number } | undefined>
  readEnviron?: (pid: number) => Promise<string[]>
  sleep?: (ms: number) => Promise<void>
  stopPollCount?: number
  healthTimeoutMs?: number
}

export interface MaintenanceOptions {
  dataDir: string
  releaseLink: string
  releaseRoot: string
  unit: string
  watchdogUnit: string
  healthUrl: string
  ops?: MaintenanceOps
}

const defaultReadEnviron = async (pid: number) => (await readFile(`/proc/${pid}/environ`, 'utf8')).split('\0')

async function realOrResolved(path: string) {
  return realpath(path).catch(() => resolve(path))
}

async function assertUnitMatchesDataDir(
  runCtl: (...args: string[]) => Promise<string>,
  readEnviron: (pid: number) => Promise<string[]>,
  options: MaintenanceOptions,
  root: string
) {
  if ((await runCtl('show', options.unit, '--property=WorkingDirectory', '--value')) !== options.releaseLink)
    throw new Error('Service WorkingDirectory must point to the release symlink.')
  const startCmd = await runCtl('show', options.unit, '--property=ExecStart', '--value')
  if (!startCmd.includes(join(options.releaseLink, 'server/main.ts'))) throw new Error('Service ExecStart must point to the release symlink.')

  const watchdogCmd = await runCtl('show', options.watchdogUnit, '--property=ExecStart', '--value')
  if (!watchdogCmd.includes(join(root, 'runner/watchdog.ts')) || !watchdogCmd.includes(join(root, 'job.json'))) throw new Error('Watchdog unit does not match this data directory.')
  const watchdogActive = await runCtl('show', options.watchdogUnit, '--property=ActiveState', '--value')
  if (watchdogActive === 'active' || watchdogActive === 'activating' || watchdogActive === 'deactivating')
    throw new Error(`Watchdog unit ${options.watchdogUnit} is ${watchdogActive}; wait for deployment to finish.`)

  const expectedData = await realOrResolved(options.dataDir)
  const mainPid = Number(await runCtl('show', options.unit, '--property=MainPID', '--value'))
  if (mainPid > 0) {
    const env = await readEnviron(mainPid)
    const serviceData = env.find(v => v.startsWith('LILBOT_DATA_DIR='))?.slice('LILBOT_DATA_DIR='.length) ?? join(homedir(), '.local/share/lilbot')
    if ((await realOrResolved(serviceData)) !== expectedData) throw new Error('Data directory does not match the running service.')
  } else {
    const unitEnv = await runCtl('show', options.unit, '--property=Environment', '--value')
    const match = /(?:^|\s)LILBOT_DATA_DIR=(\S+)/.exec(unitEnv)
    if (match?.[1] && (await realOrResolved(match[1])) !== expectedData) throw new Error('Data directory does not match the service unit configuration.')
  }
}

async function waitStopped(runCtl: (...args: string[]) => Promise<string>, unit: string, sleep: (ms: number) => Promise<void>, polls: number) {
  for (let i = 0; i < polls; i++) {
    const active = await runCtl('show', unit, '--property=ActiveState', '--value')
    const sub = await runCtl('show', unit, '--property=SubState', '--value')
    if (active === 'inactive' && sub === 'dead') return
    if (active === 'failed') throw new Error(`${unit} entered failed/${sub} state while stopping.`)
    await sleep(500)
  }
  throw new Error(`${unit} did not reach inactive/dead state within 30 seconds.`)
}

async function waitUnitHealthy(
  runCtl: (...args: string[]) => Promise<string>,
  checkHealth: (url: string) => Promise<{ ok: boolean; commit: string; pid: number } | undefined>,
  sleep: (ms: number) => Promise<void>,
  unit: string,
  healthUrl: string,
  commit: string,
  timeoutMs: number
): Promise<number | null> {
  const deadline = Date.now() + timeoutMs
  do {
    const body = await checkHealth(healthUrl)
    if (body?.ok && body.commit === commit && body.pid > 0) {
      const mainPid = Number(await runCtl('show', unit, '--property=MainPID', '--value'))
      if (mainPid === body.pid) return body.pid
    }
    await sleep(500)
  } while (Date.now() < deadline)
  return null
}

/** Stops or starts `unit` under `<data>/deploy/lock/maintenance.json` with the same unit/dataDir/PID guards as `deploy`. */
export async function runMaintenance(action: 'stop' | 'start', options: MaintenanceOptions) {
  const runCtl = options.ops?.systemctl ?? systemctl
  const checkHealth = options.ops?.health ?? health
  const readEnviron = options.ops?.readEnviron ?? defaultReadEnviron
  const sleep = options.ops?.sleep ?? (ms => Bun.sleep(ms))
  const root = join(resolve(options.dataDir), 'deploy')
  const lockDir = join(root, 'lock')
  const marker = join(lockDir, MAINTENANCE_LOCK_FILE)

  await assertUnitMatchesDataDir(runCtl, readEnviron, options, root)

  if (action === 'stop') {
    await mkdir(root, { recursive: true, mode: 0o700 })
    await mkdir(lockDir, { mode: 0o700 }).catch(() => {
      throw new Error('Deployment or maintenance lock is already held. Inspect deploy/lock and deploy/job.json first.')
    })
    let stopAttempted = false
    try {
      const lock: MaintenanceLock = { startedAt: new Date().toISOString(), unit: options.unit, watchdogUnit: options.watchdogUnit, dataDir: resolve(options.dataDir) }
      await writeJson(marker, lock)
      stopAttempted = true
      await runCtl('stop', options.unit)
      await waitStopped(runCtl, options.unit, sleep, options.ops?.stopPollCount ?? 60)
    } catch (error) {
      if (!stopAttempted) {
        await rm(lockDir, { recursive: true, force: true }).catch(() => {})
        throw error
      }
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        `${options.unit} failed to stop cleanly (${detail}); maintenance lock retained at ${lockDir}. Inspect "systemctl --user status ${options.unit}" and recover with "bun run deploy --maintenance start".`
      )
    }
    return { status: 'stopped' as const, unit: options.unit, lockDir }
  }

  const lock = await readJson<MaintenanceLock>(marker).catch(() => null)
  if (!lock || resolve(lock.dataDir) !== resolve(options.dataDir) || lock.unit !== options.unit) {
    throw new Error('No matching maintenance lock found. Refusing to start over a deployment or manual-recovery lock.')
  }
  const release = await currentRelease(options.releaseLink, options.releaseRoot)
  if (!release) throw new Error('No current release found behind release symlink.')
  const commit = await releaseCommit(release)
  await runCtl('start', options.unit)
  const pid = await waitUnitHealthy(runCtl, checkHealth, sleep, options.unit, options.healthUrl, commit, options.ops?.healthTimeoutMs ?? 60_000)
  if (pid === null) {
    await runCtl('stop', options.unit).catch(() => {})
    throw new Error(`${options.unit} failed health or MainPID verification after maintenance start; service stopped and maintenance lock retained at ${lockDir}.`)
  }
  await rm(lockDir, { recursive: true, force: true })
  return { status: 'started' as const, unit: options.unit, commit, pid }
}
