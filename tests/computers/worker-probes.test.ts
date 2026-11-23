import { afterEach, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeCodeDriver } from '../../helper/drivers/claude-code/worker-driver-claude'
import { codexProbe } from '../../helper/drivers/codex/worker-probe-codex'
import { hermesDriver } from '../../helper/drivers/hermes/worker-driver-hermes'
import { detectHermesSignedIn } from '../../helper/drivers/hermes/worker-hermes-env'
import { detectWorkerAgents } from '../../helper/worker-driver'
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
  expect(await claudeCodeDriver({ bin: signedInBin, platform: 'linux' }).detect()).toEqual({ driver: 'claude-code', version: '2.1.327', supported: true, signedIn: true })
  expect(await claudeCodeDriver({ bin: signedOutBin, platform: 'linux' }).detect()).toEqual({ driver: 'claude-code', version: '2.1.327', supported: true, signedIn: false })
})

test('macOS skips claude auth status and codex login status while keeping version detection', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'probe-macos-'))
  dirs.push(dir)
  const logFile = join(dir, 'invocations.log')
  const claudeBin = writeScript(
    dir,
    'claude-mac',
    `import { appendFileSync } from 'node:fs'
const a = process.argv.slice(2)
appendFileSync(${JSON.stringify(logFile)}, 'claude:' + a.join(' ') + '\\n')
if (a.includes('--version')) { console.log('2.1.327 (Claude Code)'); process.exit(0) }
console.log('{"loggedIn":true}')`
  )
  const codexBin = writeScript(
    dir,
    'codex-mac',
    `import { appendFileSync } from 'node:fs'
const a = process.argv.slice(2)
appendFileSync(${JSON.stringify(logFile)}, 'codex:' + a.join(' ') + '\\n')
if (a.includes('--version')) { console.log('codex-cli 0.171.0'); process.exit(0) }
process.exit(0)`
  )

  expect(await claudeCodeDriver({ bin: claudeBin, platform: 'darwin' }).detect()).toEqual({ driver: 'claude-code', version: '2.1.327', supported: true })
  expect(await codexProbe({ bin: codexBin, platform: 'darwin' }).detect()).toEqual({ driver: 'codex', version: '0.171.0', supported: false })
  const calls = (await Bun.file(logFile).text()).trim().split('\n')
  expect(calls).toEqual(['claude:--version', 'codex:--version'])

  expect(await claudeCodeDriver({ bin: claudeBin, platform: 'linux' }).detect()).toEqual({ driver: 'claude-code', version: '2.1.327', supported: true, signedIn: true })
  expect(await codexProbe({ bin: codexBin, platform: 'linux' }).detect()).toEqual({ driver: 'codex', version: '0.171.0', supported: false, signedIn: true })
})

test('hermesDriver and codexProbe report version, support flag, and safe sign-in status', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'probe-multi-'))
  dirs.push(dir)
  const hermesHome = join(dir, 'hermes-home')
  mkdirSync(hermesHome, { recursive: true })
  writeFileSync(join(hermesHome, 'config.yaml'), 'model:\n  provider: openrouter\n')

  const hermesAcpBin = writeScript(
    dir,
    'hermes-acp',
    `const a = process.argv.slice(2)
if (a[0] === 'acp' && a[1] === '--version') { console.log('0.23.1'); process.exit(0) }
process.exit(1)`
  )
  const hermesFallbackBin = writeScript(
    dir,
    'hermes-old',
    `const a = process.argv.slice(2)
if (a[0] === '--version') { console.log('Hermes Agent v0.22.0 (2026.9.0) · stable'); process.exit(0) }
process.exit(1)`
  )
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

  const agents = await detectWorkerAgents([claudeCodeDriver({ bin: claudeBin }), hermesDriver({ bin: hermesAcpBin, hermesHome, env: {} })], [codexProbe({ bin: codexBin })])
  expect(agents).toEqual([
    { driver: 'claude-code', version: '2.1.327', supported: true, signedIn: true },
    { driver: 'hermes', version: '0.23.1', supported: true, signedIn: true },
    { driver: 'codex', version: '0.170.0', supported: false, signedIn: true }
  ])
  expect(await hermesDriver({ bin: hermesFallbackBin, hermesHome, env: {} }).detect()).toEqual({
    driver: 'hermes',
    version: '0.22.0',
    supported: true,
    signedIn: true
  })
  expect(await codexProbe({ bin: codexOutBin }).detect()).toEqual({ driver: 'codex', version: '0.170.0', supported: false, signedIn: false })
})

test('detectHermesSignedIn never opens auth.json or .env and uses only config.yaml or env var presence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hermes-sign-'))
  dirs.push(dir)
  expect(detectHermesSignedIn(dir, {})).toBe(false)

  // Even an unreadable auth.json (mode 000) or one with active_provider must NOT be opened -> stays undefined.
  const authPath = join(dir, 'auth.json')
  writeFileSync(authPath, JSON.stringify({ active_provider: 'nous', token: 'must-never-be-read' }))
  chmodSync(authPath, 0o000)
  expect(detectHermesSignedIn(dir, {})).toBeUndefined()
  chmodSync(authPath, 0o600)
  expect(detectHermesSignedIn(dir, {})).toBeUndefined()

  // .env alone is also never opened -> undefined.
  rmSync(authPath)
  writeFileSync(join(dir, '.env'), 'SECRET_KEY=must-never-be-read\n')
  expect(detectHermesSignedIn(dir, {})).toBeUndefined()

  // Non-secret config.yaml or env var presence confirms true.
  expect(detectHermesSignedIn(dir, { OPENROUTER_API_KEY: 'present' })).toBe(true)
  writeFileSync(join(dir, 'config.yaml'), 'model:\n  provider: openrouter\n')
  expect(detectHermesSignedIn(dir, {})).toBe(true)
})

test('worker-door reconciles worker capability against server-supported drivers, overriding bogus helper claims', () => {
  const dir = mkdtempSync(join(tmpdir(), 'door-unsup-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'lilbot.db'))
  const store = new ComputerStore(db)
  store.add('c1', { name: 'Box', os: 'darwin', home: dir, capabilities: ['exec', 'worker'] }, 'pub')
  const state = createWorkerSocketState()
  const agents = [
    { driver: 'codex' as const, version: '0.170.0', supported: true, signedIn: true },
    { driver: 'hermes' as const, version: '0.23.1', supported: false, signedIn: true }
  ]
  handleWorkerFrame(db, 'c1', { type: 'worker.capabilities', agents }, state, 10_000, 100, () => true)
  const comp = store.list().find(c => c.id === 'c1')!
  expect(comp.capabilities).not.toContain('worker')
  expect(comp.workerAgents).toEqual([
    { driver: 'codex', version: '0.170.0', supported: false, signedIn: true },
    { driver: 'hermes', version: '0.23.1', supported: false, signedIn: true }
  ])
  handleWorkerFrame(db, 'c1', { type: 'worker.capabilities', agents: [{ driver: 'hermes', version: '0.23.1', supported: true, signedIn: true }] }, state, 15_000, 100, () => true)
  expect(store.list().find(c => c.id === 'c1')!.capabilities).toContain('worker')

  // Older helper sending only driver + version for claude-code grants worker capability.
  const legacy = [{ driver: 'claude-code' as const, version: '2.1.327' }]
  handleWorkerFrame(db, 'c1', { type: 'worker.capabilities', agents: legacy }, state, 20_000, 100, () => true)
  const upgraded = store.list().find(c => c.id === 'c1')!
  expect(upgraded.capabilities).toContain('worker')
  // Unknown future driver from a newer helper persists cleanly as supported: false without granting worker capability.
  handleWorkerFrame(db, 'c1', { type: 'worker.capabilities', agents: [{ driver: 'pi', version: '0.5.0', supported: true }] }, state, 25_000, 100, () => true)
  const future = store.list().find(c => c.id === 'c1')!
  expect(future.capabilities).not.toContain('worker')
  expect(future.workerAgents).toEqual([{ driver: 'pi', version: '0.5.0', supported: false }])
  db.close()
})
