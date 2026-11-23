import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectWorkerAgents } from '../../helper/worker-driver'
import { claudeCodeDriver } from '../../helper/worker-driver-claude'
import { codexProbe, detectHermesSignedIn, hermesProbe } from '../../helper/worker-probes'
import { ComputerStore } from '../../server/computers/computer-store'
import { createWorkerSocketState, handleWorkerFrame } from '../../server/computers/worker-door'
import { openDatabase } from '../../server/database/database'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function writeScript(dir: string, name: string, body: string) {
  const path = join(dir, name)
  writeFileSync(path, `#!/usr/bin/env bun\n${body}\n`, { mode: 0o700 })
  return path
}

test('claudeCodeDriver detects version and boolean signedIn without leaking account fields', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'probe-claude-'))
  dirs.push(dir)
  const signedInBin = writeScript(
    dir,
    'claude-in',
    `const a = process.argv.slice(2)
if (a.includes('--version')) { console.log('2.1.327 (Claude Code)'); process.exit(0) }
if (a[0] === 'auth' && a[1] === 'status') { console.log(JSON.stringify({ loggedIn: true, email: 'secret@example.com', orgId: 'org-1' })); process.exit(0) }
process.exit(1)`
  )
  const signedOutBin = writeScript(
    dir,
    'claude-out',
    `const a = process.argv.slice(2)
if (a.includes('--version')) { console.log('2.1.327'); process.exit(0) }
if (a[0] === 'auth' && a[1] === 'status') { console.log(JSON.stringify({ loggedIn: false })); process.exit(0) }
process.exit(1)`
  )
  expect(await claudeCodeDriver({ bin: signedInBin }).detect()).toEqual({ driver: 'claude-code', version: '2.1.327', supported: true, signedIn: true })
  expect(await claudeCodeDriver({ bin: signedOutBin }).detect()).toEqual({ driver: 'claude-code', version: '2.1.327', supported: true, signedIn: false })
})

test('hermesProbe and codexProbe report version, supported=false, and safe sign-in status', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'probe-multi-'))
  dirs.push(dir)
  const hermesHome = join(dir, 'hermes-home')
  mkdirSync(hermesHome, { recursive: true })
  writeFileSync(join(hermesHome, 'config.yaml'), 'model:\n  provider: openrouter\n')

  const hermesBin = writeScript(dir, 'hermes', `console.log('Hermes Agent v0.23.1 (2026.9.24) · stable')`)
  const codexBin = writeScript(
    dir,
    'codex',
    `const a = process.argv.slice(2)
if (a.includes('--version')) { console.log('codex-cli 0.170.0'); process.exit(0) }
if (a[0] === 'login' && a[1] === 'status') { console.log('Logged in using ChatGPT'); process.exit(0) }
process.exit(1)`
  )
  const codexOutBin = writeScript(
    dir,
    'codex-out',
    `const a = process.argv.slice(2)
if (a.includes('--version')) { console.log('codex-cli 0.170.0'); process.exit(0) }
process.exit(1)`
  )
  const claudeBin = writeScript(
    dir,
    'claude',
    `const a = process.argv.slice(2)
if (a.includes('--version')) { console.log('2.1.327 (Claude Code)'); process.exit(0) }
if (a[0] === 'auth') { console.log('{"loggedIn":true}'); process.exit(0) }
process.exit(1)`
  )

  const agents = await detectWorkerAgents([claudeCodeDriver({ bin: claudeBin })], [hermesProbe({ bin: hermesBin, hermesHome, env: {} }), codexProbe({ bin: codexBin })])
  expect(agents).toEqual([
    { driver: 'claude-code', version: '2.1.327', supported: true, signedIn: true },
    { driver: 'hermes', version: '0.23.1', supported: false, signedIn: true },
    { driver: 'codex', version: '0.170.0', supported: false, signedIn: true }
  ])
  expect(await codexProbe({ bin: codexOutBin }).detect()).toEqual({ driver: 'codex', version: '0.170.0', supported: false, signedIn: false })
})

test('detectHermesSignedIn never reads .env and distinguishes empty, configured, and ambiguous homes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hermes-sign-'))
  dirs.push(dir)
  expect(detectHermesSignedIn(dir, {})).toBe(false)
  writeFileSync(join(dir, '.env'), 'SECRET_KEY=must-never-be-read\n')
  expect(detectHermesSignedIn(dir, {})).toBeUndefined()
  writeFileSync(join(dir, 'auth.json'), JSON.stringify({ active_provider: 'nous' }))
  expect(detectHermesSignedIn(dir, {})).toBe(true)
})

test('worker-door omits worker capability when only unsupported engines are reported', () => {
  const dir = mkdtempSync(join(tmpdir(), 'door-unsup-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'lilbot.db'))
  const store = new ComputerStore(db)
  store.add('c1', { name: 'Box', os: 'darwin', home: dir, capabilities: ['exec'] }, 'pub')
  const state = createWorkerSocketState()
  const agents = [{ driver: 'codex' as const, version: '0.170.0', supported: false, signedIn: true }]
  handleWorkerFrame(db, 'c1', { type: 'worker.capabilities', agents }, state, 10_000, 100, () => true)
  const comp = store.list().find(c => c.id === 'c1')!
  expect(comp.capabilities).not.toContain('worker')
  expect(comp.workerAgents).toEqual(agents)

  // Older helper sending only driver + version (omitting supported) grants worker capability.
  const legacy = [{ driver: 'claude-code' as const, version: '2.1.327' }]
  handleWorkerFrame(db, 'c1', { type: 'worker.capabilities', agents: legacy }, state, 20_000, 100, () => true)
  const upgraded = store.list().find(c => c.id === 'c1')!
  expect(upgraded.capabilities).toContain('worker')
  expect(upgraded.workerAgents).toEqual(legacy)
  db.close()
})
