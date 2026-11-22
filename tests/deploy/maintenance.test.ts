import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAINTENANCE_LOCK_FILE, runMaintenance } from '../../server/deploy/maintenance'

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

function fakeCtl(state: { active: string; sub: string; calls: string[][] }) {
  return async (...args: string[]) => {
    state.calls.push(args)
    if (args[0] === 'show' && args[2] === '--property=WorkingDirectory') return releaseLink
    if (args[0] === 'show' && args[2] === '--property=ExecStart') return `/usr/bin/bun ${join(releaseLink, 'server/main.ts')}`
    if (args[0] === 'show' && args[2] === '--property=ActiveState') return state.active
    if (args[0] === 'show' && args[2] === '--property=SubState') return state.sub
    if (args[0] === 'stop') {
      state.active = 'inactive'
      state.sub = 'dead'
    }
    if (args[0] === 'start') {
      state.active = 'active'
      state.sub = 'running'
    }
    return ''
  }
}

test('maintenance stop acquires deploy lock with marker and start verifies health before releasing lock', async () => {
  const state = { active: 'active', sub: 'running', calls: [] as string[][] }
  const ops = { systemctl: fakeCtl(state), waitHealthy: async () => true, sleep: async () => {} }
  const opts = { dataDir, releaseLink, releaseRoot, unit: 'lilbot.service', healthUrl: 'http://127.0.0.1:3370/api/health', ops }

  const stopped = await runMaintenance('stop', opts)
  expect(stopped.status).toBe('stopped')
  expect(existsSync(join(dataDir, 'deploy', 'lock', MAINTENANCE_LOCK_FILE))).toBe(true)
  await expect(runMaintenance('stop', opts)).rejects.toThrow('already held')

  const started = await runMaintenance('start', opts)
  expect(started).toEqual({ status: 'started', unit: 'lilbot.service', commit })
  expect(existsSync(join(dataDir, 'deploy', 'lock'))).toBe(false)
})

test('maintenance start refuses over a non-maintenance deploy lock and keeps lock when health fails', async () => {
  const state = { active: 'inactive', sub: 'dead', calls: [] as string[][] }
  const lockDir = join(dataDir, 'deploy', 'lock')
  mkdirSync(lockDir, { recursive: true })
  const base = { dataDir, releaseLink, releaseRoot, unit: 'lilbot.service', healthUrl: 'http://127.0.0.1:3370/api/health' }

  await expect(runMaintenance('start', { ...base, ops: { systemctl: fakeCtl(state), waitHealthy: async () => true, sleep: async () => {} } })).rejects.toThrow(
    'No matching maintenance lock'
  )

  rmSync(lockDir, { recursive: true, force: true })
  await runMaintenance('stop', { ...base, ops: { systemctl: fakeCtl(state), waitHealthy: async () => true, sleep: async () => {} } })
  await expect(runMaintenance('start', { ...base, ops: { systemctl: fakeCtl(state), waitHealthy: async () => false, sleep: async () => {} } })).rejects.toThrow(
    'failed health check'
  )
  expect(state.active).toBe('inactive')
  expect(existsSync(join(lockDir, MAINTENANCE_LOCK_FILE))).toBe(true)
})
