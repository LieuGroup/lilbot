/** Maintenance stop/start owned by `bun run deploy`, holding `<data>/deploy/lock/` for offline maintenance (such as bot re-keying). */
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { readJson, writeJson } from './files'
import { waitHealthy } from './health'
import { systemctl } from './process'
import { currentRelease, releaseCommit } from './releases'

export const MAINTENANCE_LOCK_FILE = 'maintenance.json'

export interface MaintenanceLock {
  startedAt: string
  unit: string
  dataDir: string
}

export interface MaintenanceOptions {
  dataDir: string
  releaseLink: string
  releaseRoot: string
  unit: string
  healthUrl: string
  ops?: {
    systemctl?: (...args: string[]) => Promise<string>
    waitHealthy?: (url: string, commit: string) => Promise<boolean>
    sleep?: (ms: number) => Promise<void>
  }
}

async function waitStopped(runCtl: (...args: string[]) => Promise<string>, unit: string, sleep: (ms: number) => Promise<void>) {
  for (let i = 0; i < 60; i++) {
    const active = await runCtl('show', unit, '--property=ActiveState', '--value')
    const sub = await runCtl('show', unit, '--property=SubState', '--value')
    if (active === 'inactive' && sub === 'dead') return
    await sleep(500)
  }
  throw new Error(`${unit} did not reach inactive/dead state within 30 seconds.`)
}

export async function runMaintenance(action: 'stop' | 'start', options: MaintenanceOptions) {
  const runCtl = options.ops?.systemctl ?? systemctl
  const checkHealthy = options.ops?.waitHealthy ?? waitHealthy
  const sleep = options.ops?.sleep ?? (ms => Bun.sleep(ms))
  const root = join(resolve(options.dataDir), 'deploy')
  const lockDir = join(root, 'lock')
  const marker = join(lockDir, MAINTENANCE_LOCK_FILE)

  if ((await runCtl('show', options.unit, '--property=WorkingDirectory', '--value')) !== options.releaseLink)
    throw new Error('Service WorkingDirectory must point to the release symlink.')
  const startCmd = await runCtl('show', options.unit, '--property=ExecStart', '--value')
  if (!startCmd.includes(join(options.releaseLink, 'server/main.ts'))) throw new Error('Service ExecStart must point to the release symlink.')

  if (action === 'stop') {
    await mkdir(root, { recursive: true, mode: 0o700 })
    await mkdir(lockDir, { mode: 0o700 }).catch(() => {
      throw new Error('Deployment or maintenance lock is already held. Inspect deploy/lock and deploy/job.json first.')
    })
    let locked = false
    try {
      await writeJson(marker, { startedAt: new Date().toISOString(), unit: options.unit, dataDir: resolve(options.dataDir) } satisfies MaintenanceLock)
      await runCtl('stop', options.unit)
      await waitStopped(runCtl, options.unit, sleep)
      locked = true
    } finally {
      if (!locked) await rm(lockDir, { recursive: true, force: true })
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
  if (!(await checkHealthy(options.healthUrl, commit))) {
    await runCtl('stop', options.unit).catch(() => {})
    throw new Error(`${options.unit} failed health check after maintenance start; service stopped and lock retained for inspection.`)
  }
  await rm(lockDir, { recursive: true, force: true })
  return { status: 'started' as const, unit: options.unit, commit }
}
