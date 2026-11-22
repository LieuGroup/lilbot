/** Process, systemd-state, and deploy-lock guards for bot re-keying. Never logs secrets. */
import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { MAINTENANCE_LOCK_FILE, type MaintenanceLock } from '../../server/deploy/maintenance'

export interface ServiceProbeResult {
  exitCode: number
  stdout: string
}

function checkServiceState(dataDir: string, probe?: () => ServiceProbeResult) {
  const resolvedData = resolve(dataDir)
  const result = probe
    ? probe()
    : (() => {
        const res = Bun.spawnSync(['systemctl', '--user', 'show', '-p', 'LoadState,ActiveState,SubState,Environment', 'lilbot.service'], { stdout: 'pipe', stderr: 'ignore' })
        return { exitCode: res.exitCode ?? 1, stdout: res.stdout.toString() }
      })()
  if (result.exitCode !== 0) return
  const out = result.stdout
  const loadState = /^LoadState=(.+)$/m.exec(out)?.[1]?.trim() ?? ''
  if (!loadState || loadState === 'not-found') return
  const envMatch = /LILBOT_DATA_DIR=(\S+)/.exec(out)
  const serviceDataDir = resolve(envMatch?.[1] ?? join(homedir(), '.local', 'share', 'lilbot'))
  if (serviceDataDir !== resolvedData) return
  const activeState = /^ActiveState=(.+)$/m.exec(out)?.[1]?.trim() ?? 'unknown'
  const subState = /^SubState=(.+)$/m.exec(out)?.[1]?.trim() ?? 'unknown'
  if (activeState !== 'inactive' || subState !== 'dead') {
    throw new Error(`Refusing to run: lilbot.service is ${activeState}/${subState} against this data directory. Stop it cleanly via "bun run deploy --maintenance stop" first.`)
  }
}

function checkDeployLock(dataDir: string) {
  const resolvedData = resolve(dataDir)
  const lockDir = join(resolvedData, 'deploy', 'lock')
  if (!existsSync(lockDir)) return
  const marker = join(lockDir, MAINTENANCE_LOCK_FILE)
  try {
    const lock = JSON.parse(readFileSync(marker, 'utf8')) as Partial<MaintenanceLock>
    if (typeof lock.dataDir === 'string' && resolve(lock.dataDir) === resolvedData) return
  } catch {}
  throw new Error(`Refusing to run: deployment lock exists at ${lockDir}. Wait for the deployment or resolve manual recovery before running.`)
}

/** Refuses if `lilbot.service` is not fully stopped, a non-maintenance deploy lock exists, or any PID holds `lilbot.db` open. */
export function assertDatabaseNotInUse(dataDir: string, serviceProbe?: () => ServiceProbeResult) {
  const resolvedData = resolve(dataDir)
  const dbPath = resolve(resolvedData, 'lilbot.db')
  checkServiceState(resolvedData, serviceProbe)
  checkDeployLock(resolvedData)

  if (!existsSync('/proc')) return
  const targets = new Set([dbPath, `${dbPath}-wal`, `${dbPath}-shm`])
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    const pid = Number(entry)
    if (pid === process.pid) continue
    let fds: string[]
    try {
      fds = readdirSync(`/proc/${pid}/fd`)
    } catch {
      continue
    }
    for (const fd of fds) {
      let target: string
      try {
        target = readlinkSync(`/proc/${pid}/fd/${fd}`)
      } catch {
        continue
      }
      if (!targets.has(target)) continue
      let comm = 'process'
      try {
        comm = readFileSync(`/proc/${pid}/comm`, 'utf8').trim() || comm
      } catch {}
      throw new Error(`Refusing to run: ${comm} (pid ${pid}) currently has this database open. Stop it first.`)
    }
  }
}
