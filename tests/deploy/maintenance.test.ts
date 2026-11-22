import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAINTENANCE_LOCK_FILE, runMaintenance } from '../../server/deploy/maintenance'

const UNIT = 'lilbot.service'
const WATCHDOG = 'lilbot-deploy.service'
const HEALTH_URL = 'http://127.0.0.1:3370/api/health'

let root = ''
let dataDir = ''
let releaseRoot = ''
let releaseLink = ''
const commit = 'a'.repeat(40)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lilbot-maint-'))
  dataDir = join(root, 'data')
  releaseRoot = join(root, 'releases')
  releaseLink = join(root, 'release')
  const rel = join(releaseRoot, commit)
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(rel, { recursive: true })
  writeFileSync(join(rel, '.lilbot-release.json'), JSON.stringify({ commit }))
  symlinkSync(rel, releaseLink)
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

interface FakeState {
  active: string
  sub: string
  mainPid: number
  watchdogActive?: string
  watchdogDataDir?: string
  serviceDataDir?: string
  unitEnv?: string
  stopBehavior?: 'ok' | 'throw' | 'hang' | 'fail-state'
  calls: string[][]
}

function makeOps(state: FakeState, healthPid?: number | (() => number | null)) {
  const wdDir = state.watchdogDataDir ?? dataDir
  return {
    systemctl: async (...args: string[]) => {
      state.calls.push(args)
      const [cmd, target, prop] = args
      if (cmd === 'show' && target === UNIT && prop === '--property=WorkingDirectory') return releaseLink
      if (cmd === 'show' && target === UNIT && prop === '--property=ExecStart') return `/usr/bin/bun ${join(releaseLink, 'server/main.ts')}`
      if (cmd === 'show' && target === UNIT && prop === '--property=MainPID') return String(state.mainPid)
      if (cmd === 'show' && target === UNIT && prop === '--property=Environment') return state.unitEnv ?? `LILBOT_DATA_DIR=${state.serviceDataDir ?? dataDir}`
      if (cmd === 'show' && target === UNIT && prop === '--property=ActiveState') return state.active
      if (cmd === 'show' && target === UNIT && prop === '--property=SubState') return state.sub
      if (cmd === 'show' && target === WATCHDOG && prop === '--property=ExecStart')
        return `/usr/bin/bun ${join(wdDir, 'deploy', 'runner', 'watchdog.ts')} ${join(wdDir, 'deploy', 'job.json')}`
      if (cmd === 'show' && target === WATCHDOG && prop === '--property=ActiveState') return state.watchdogActive ?? 'inactive'
      if (cmd === 'stop' && target === UNIT) {
        if (state.stopBehavior === 'throw') {
          state.active = 'deactivating'
          throw new Error('systemctl stop failed')
        }
        if (state.stopBehavior === 'hang') {
          Object.assign(state, { active: 'deactivating', sub: 'stop-sigterm' })
          return ''
        }
        if (state.stopBehavior === 'fail-state') {
          Object.assign(state, { active: 'failed', sub: 'failed', mainPid: 0 })
          return ''
        }
        Object.assign(state, { active: 'inactive', sub: 'dead', mainPid: 0 })
      }
      if (cmd === 'start' && target === UNIT) Object.assign(state, { active: 'active', sub: 'running', mainPid: 4242 })
      return ''
    },
    readEnviron: async () => [`LILBOT_DATA_DIR=${state.serviceDataDir ?? dataDir}`],
    health: async () => {
      const pid = typeof healthPid === 'function' ? healthPid() : (healthPid ?? state.mainPid)
      return pid ? { ok: true, commit, pid } : undefined
    },
    sleep: async () => {},
    stopPollCount: 3,
    healthTimeoutMs: 50
  }
}

const baseOpts = () => ({ dataDir, releaseLink, releaseRoot, unit: UNIT, watchdogUnit: WATCHDOG, healthUrl: HEALTH_URL })

test('maintenance stop/start enforces dataDir, watchdog binding, MainPID===health.pid, and deploy-lock mutual exclusion', async () => {
  const wrongData = join(root, 'other-data')
  mkdirSync(wrongData, { recursive: true })

  // Mismatched running LILBOT_DATA_DIR refuses BEFORE touching unit or lock.
  const wrongEnv: FakeState = { active: 'active', sub: 'running', mainPid: 9001, serviceDataDir: wrongData, calls: [] }
  await expect(runMaintenance('stop', { ...baseOpts(), ops: makeOps(wrongEnv) })).rejects.toThrow('Data directory does not match the running service')
  expect(wrongEnv.calls.some(c => c[0] === 'stop')).toBe(false)
  expect(existsSync(join(dataDir, 'deploy', 'lock'))).toBe(false)

  // Mismatched watchdog dataDir refuses BEFORE touching unit or lock.
  const wrongWd: FakeState = { active: 'active', sub: 'running', mainPid: 9001, watchdogDataDir: wrongData, calls: [] }
  await expect(runMaintenance('stop', { ...baseOpts(), ops: makeOps(wrongWd) })).rejects.toThrow('Watchdog unit does not match')
  expect(wrongWd.calls.some(c => c[0] === 'stop')).toBe(false)

  // Active watchdog refuses.
  const busyWd: FakeState = { active: 'active', sub: 'running', mainPid: 9001, watchdogActive: 'active', calls: [] }
  await expect(runMaintenance('stop', { ...baseOpts(), ops: makeOps(busyWd) })).rejects.toThrow('Watchdog unit')

  // Happy path stop -> refuse duplicate stop -> refuse mismatched health PID -> recover with matching PID.
  const state: FakeState = { active: 'active', sub: 'running', mainPid: 9001, calls: [] }
  const stopped = await runMaintenance('stop', { ...baseOpts(), ops: makeOps(state) })
  expect(stopped.status).toBe('stopped')
  expect(existsSync(join(dataDir, 'deploy', 'lock', MAINTENANCE_LOCK_FILE))).toBe(true)
  await expect(runMaintenance('stop', { ...baseOpts(), ops: makeOps(state) })).rejects.toThrow('already held')

  // Healthy commit from wrong PID must fail, stop unit, and retain lock.
  await expect(runMaintenance('start', { ...baseOpts(), ops: makeOps(state, 99999) })).rejects.toThrow('failed health or MainPID')
  expect(state.active).toBe('inactive')
  expect(existsSync(join(dataDir, 'deploy', 'lock', MAINTENANCE_LOCK_FILE))).toBe(true)

  // Matching commit + MainPID starts cleanly and removes lock.
  const started = await runMaintenance('start', { ...baseOpts(), ops: makeOps(state) })
  expect(started).toEqual({ status: 'started', unit: UNIT, commit, pid: 4242 })
  expect(existsSync(join(dataDir, 'deploy', 'lock'))).toBe(false)
})

test('stop failure/timeout/failed-state retains maintenance lock so maintenance start can recover, and non-maintenance lock blocks start', async () => {
  const lockDir = join(dataDir, 'deploy', 'lock')
  mkdirSync(lockDir, { recursive: true })
  const idle: FakeState = { active: 'inactive', sub: 'dead', mainPid: 0, calls: [] }
  await expect(runMaintenance('start', { ...baseOpts(), ops: makeOps(idle) })).rejects.toThrow('No matching maintenance lock')
  rmSync(lockDir, { recursive: true, force: true })

  for (const mode of ['throw', 'hang', 'fail-state'] as const) {
    const state: FakeState = { active: 'active', sub: 'running', mainPid: 1111, stopBehavior: mode, calls: [] }
    await expect(runMaintenance('stop', { ...baseOpts(), ops: makeOps(state) })).rejects.toThrow('maintenance lock retained')
    expect(existsSync(join(lockDir, MAINTENANCE_LOCK_FILE))).toBe(true)
    // Operator can recover directly via maintenance start without being trapped.
    state.stopBehavior = 'ok'
    const recovered = await runMaintenance('start', { ...baseOpts(), ops: makeOps(state) })
    expect(recovered).toEqual({ status: 'started', unit: UNIT, commit, pid: 4242 })
    expect(existsSync(lockDir)).toBe(false)
  }
})

test('SIGKILL during maintenance stop or start leaves lock intact and cleanly recoverable by maintenance start', async () => {
  const lockDir = join(dataDir, 'deploy', 'lock')
  for (const killStage of ['stop-after-marker', 'start-before-unlock'] as const) {
    rmSync(lockDir, { recursive: true, force: true })
    if (killStage === 'start-before-unlock') {
      mkdirSync(lockDir, { recursive: true })
      writeFileSync(join(lockDir, MAINTENANCE_LOCK_FILE), JSON.stringify({ startedAt: new Date().toISOString(), unit: UNIT, watchdogUnit: WATCHDOG, dataDir }))
    }
    const script = `
      import { runMaintenance } from './server/deploy/maintenance.ts';
      const dataDir = ${JSON.stringify(dataDir)}, releaseLink = ${JSON.stringify(releaseLink)}, releaseRoot = ${JSON.stringify(releaseRoot)};
      const stage = ${JSON.stringify(killStage)};
      let pid = stage === 'stop-after-marker' ? 5000 : 0;
      const ops = {
        systemctl: async (...a) => {
          if (a[0] === 'show' && a[1] === '${UNIT}' && a[2] === '--property=WorkingDirectory') return releaseLink;
          if (a[0] === 'show' && a[1] === '${UNIT}' && a[2] === '--property=ExecStart') return '/usr/bin/bun ' + releaseLink + '/server/main.ts';
          if (a[0] === 'show' && a[1] === '${UNIT}' && a[2] === '--property=MainPID') return String(pid);
          if (a[0] === 'show' && a[1] === '${UNIT}' && a[2] === '--property=Environment') return 'LILBOT_DATA_DIR=' + dataDir;
          if (a[0] === 'show' && a[1] === '${WATCHDOG}' && a[2] === '--property=ExecStart') return '/usr/bin/bun ' + dataDir + '/deploy/runner/watchdog.ts ' + dataDir + '/deploy/job.json';
          if (a[0] === 'show' && a[1] === '${WATCHDOG}' && a[2] === '--property=ActiveState') return 'inactive';
          if (a[0] === 'stop' && stage === 'stop-after-marker') { console.log('READY_KILL'); await Bun.sleep(60000); }
          if (a[0] === 'start' && stage === 'start-before-unlock') { pid = 4242; console.log('READY_KILL'); await Bun.sleep(60000); }
          return '';
        },
        readEnviron: async () => ['LILBOT_DATA_DIR=' + dataDir],
        health: async () => ({ ok: true, commit: ${JSON.stringify(commit)}, pid }),
        sleep: async () => {}
      };
      await runMaintenance(stage === 'stop-after-marker' ? 'stop' : 'start', { dataDir, releaseLink, releaseRoot, unit: '${UNIT}', watchdogUnit: '${WATCHDOG}', healthUrl: '${HEALTH_URL}', ops });
    `
    const proc = Bun.spawn(['bun', '-e', script], { cwd: join(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' })
    const reader = proc.stdout.getReader()
    let out = ''
    while (!out.includes('READY_KILL')) {
      const { value, done } = await reader.read()
      if (done) break
      out += new TextDecoder().decode(value)
    }
    expect(out).toContain('READY_KILL')
    proc.kill('SIGKILL')
    await proc.exited
    expect(existsSync(join(lockDir, MAINTENANCE_LOCK_FILE))).toBe(true)

    const recoveredState: FakeState = { active: 'inactive', sub: 'dead', mainPid: 0, calls: [] }
    const res = await runMaintenance('start', { ...baseOpts(), ops: makeOps(recoveredState) })
    expect(res).toEqual({ status: 'started', unit: UNIT, commit, pid: 4242 })
    expect(existsSync(lockDir)).toBe(false)
  }
})
