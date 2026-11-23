import { devScratch } from '../scripts/dev-env'
import { startServer, deleteProfile } from './check-process'
import { checkLifecycle } from './computers-lifecycle'
import { checkPinning } from './computers-pinning'
/** Isolated server + compiled helper. Never installs a service or changes real bots. */

import { createPublicKey, generateKeyPairSync } from 'node:crypto'
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { connectionHeaders } from '../helper/identity'
import { botCapability } from '../server/bots/bot-capability'
import { BotStore } from '../server/bots/bot-store'
import { openDatabase } from '../server/database/database'
import { browser, eventually } from './computers-client'
import { devPort } from '../scripts/dev-paths'

const scratch = devScratch('lilbot-computers')
const binary = join(scratch, 'lilbot-helper')
const port = devPort()
const doorPort = devPort()
const door = `http://127.0.0.1:${doorPort}`
const helperConfig = join(scratch, 'helper')
const env = { ...process.env, LILBOT_HELPER_CONFIG_DIR: helperConfig }
let server: ReturnType<typeof Bun.spawn> | undefined
let helper: ReturnType<typeof Bun.spawn> | undefined
let client: Awaited<ReturnType<typeof browser>> | undefined
const stopHelper = async () => {
  helper?.kill()
  if (helper) await helper.exited
  helper = undefined
}
const launchHelper = () => {
  helper = Bun.spawn([binary, 'run'], { env, stdout: 'ignore', stderr: 'inherit' })
}
try {
  const hardStop = Bun.spawn(['python3', '-B', 'live-checks/computers-hard-stop.py'], { stdout: 'inherit', stderr: 'inherit' })
  if (await hardStop.exited) throw new Error('Hard-stop check failed')
  const build = Bun.spawn(['bun', 'build', '--compile', 'helper/main.ts', '--outfile', binary], { env: process.env, stdout: 'ignore', stderr: 'inherit' })
  if (await build.exited) throw new Error('Helper build failed')
  const { mkdirSync } = await import('node:fs')
  const lifecycleRoot = join(scratch, 'lifecycle')
  mkdirSync(lifecycleRoot)
  await checkLifecycle([binary], lifecycleRoot)
  server = startServer({
    ...process.env,
    LILBOT_PORT: String(port),
    LILBOT_PUBLIC_ENABLED: '1',
    LILBOT_PUBLIC_PORT: String(doorPort),
    LILBOT_DATA_DIR: scratch,
    LILBOT_WORKSPACES_DIR: join(scratch, 'workspaces'),
    LILBOT_SKILLS_DIR: join(scratch, 'skills'),
    LILBOT_BOT_IDS: 'isolated-no-profiles',
    LILBOT_SKIP_MEMORY_SETUP: '1',
    LILBOT_REVIEW: 'off'
  })
  await eventually(() =>
    fetch(`http://127.0.0.1:${port}/api/health`)
      .then(r => r.ok)
      .catch(() => false)
  )
  for (const headers of [{ 'cf-ray': 'test' }, { 'cf-connecting-ip': '127.0.0.1' }, { 'cdn-loop': 'cloudflare' }] as Record<string, string>[]) {
    if ((await fetch(`http://127.0.0.1:${port}/api/health`, { headers: headers })).status !== 403) throw new Error('Private listener accepted tunnel headers')
  }
  client = await browser(port)
  const call = client.call
  const { code } = await call('computers.installCode', { name: 'Isolated helper' })
  const register = Bun.spawn([binary, 'register', door], { env, stdin: 'pipe', stdout: 'ignore', stderr: 'inherit' })
  register.stdin.write(code)
  register.stdin.end()
  if (await register.exited) throw new Error('Registration failed')
  launchHelper()
  const identity = JSON.parse(readFileSync(join(helperConfig, 'identity.json'), 'utf8'))
  await eventually(async () => (await call('computers.list')).some((c: any) => c.id === identity.id && c.online))
  console.log('PASS: compiled helper registered and online')
  console.log('Creating isolated temporary bot')
  const bot = await call('bots.create', {
    name: 'Computer check',
    instructions: 'Use the LilBot computer tools for this check. Do not substitute local terminal or other tools.',
    model: { provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-5-5' }
  })
  const token = readFileSync(join(scratch, 'engine-token'), 'utf8').trim()
  const engine = async (action: string, body: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}/engine/computers/${action}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-lilbot-bot-capability': botCapability(token, bot.id), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(35_000)
    })
    const result = (await response.json()) as any
    if (!response.ok) throw new Error(result.error)
    return result
  }
  console.log('Checking real computer tools in a fresh bot session')
  await client.turn(
    bot.id,
    `Use list_computers, then use computer_exec on computer ${identity.id} with requestId live-exec to run "printf EXEC_OK". Then computer_write_file on that computer with requestId live-write writes exactly FILE_OK to ${scratch}/bot-file, then computer_read_file with requestId live-read reads it. Do not use other tools.`
  )
  for (const name of ['list_computers', 'computer_exec', 'computer_write_file', 'computer_read_file']) {
    if (!client.toolNames.has(name)) throw new Error(`Bot did not use ${name}`)
  }
  const written = await engine('read', { computer: identity.id, requestId: 'live-write' })
  const read = await engine('read', { computer: identity.id, requestId: 'live-read' })
  const exec = await engine('read', { computer: identity.id, requestId: 'live-exec' })
  if (written.status !== 'completed' || Buffer.from(read.result.output, 'base64').toString() !== 'FILE_OK' || exec.result.output !== 'EXEC_OK')
    throw new Error('Bot computer tools did not complete')
  console.log('PASS: real bot listed computers, executed, wrote and read through plugin')
  const refusedDirect = await fetch(`http://127.0.0.1:${port}/engine/computers/submit`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'x-lilbot-bot-capability': botCapability(token, bot.id), 'Content-Type': 'application/json' },
    body: JSON.stringify({ computer: identity.id, requestId: 'direct-hard-stop', background: true, operation: { kind: 'exec', command: 'if false; then mkfs; fi' } })
  })
  const refusedBody = (await refusedDirect.json()) as { error?: string }
  if (refusedDirect.status !== 422 || !refusedBody.error?.includes('LilBot safety stop')) {
    throw new Error(`Direct submit did not enforce LilBot safety stop: ${refusedDirect.status} ${JSON.stringify(refusedBody)}`)
  }
  console.log('PASS: LilBot safety stop refused destructive direct submission with 422')
  await stopHelper()
  await eventually(async () => !(await call('computers.list')).find((c: any) => c.id === identity.id).online)
  const input = { computer: identity.id, requestId: 'offline-once', background: true, operation: { kind: 'exec', command: `printf ONCE >> '${scratch}/once'` } }
  const queued = await engine('submit', input)
  const retry = await engine('submit', input)
  if (queued.id !== retry.id) throw new Error('Duplicate queue identity')
  let offlineFailed = false
  try {
    await engine('submit', { ...input, requestId: 'offline-sync', background: false })
  } catch {
    offlineFailed = true
  }
  if (!offlineFailed) throw new Error('Offline synchronous request was accepted')
  launchHelper()
  await eventually(async () => (await engine('read', input)).status === 'completed')
  await stopHelper()
  launchHelper()
  await eventually(async () => (await call('computers.list')).find((c: any) => c.id === identity.id).online)
  await engine('submit', input)
  if (readFileSync(join(scratch, 'once'), 'utf8') !== 'ONCE') throw new Error('Command executed twice')
  console.log('PASS: offline queue reconnects and executes once across helper restart; sync fails clearly')
  const long = {
    computer: identity.id,
    requestId: 'cancel-live',
    background: true,
    operation: { kind: 'exec', command: `printf '%s' $$ > '${scratch}/cancel-pid'; exec sleep 120` }
  }
  await engine('submit', long)
  await eventually(async () => existsSync(join(scratch, 'cancel-pid')))
  const pid = Number(readFileSync(join(scratch, 'cancel-pid'), 'utf8'))
  await engine('cancel', long)
  await eventually(async () => (await engine('read', long)).status === 'cancel_acked')
  try {
    process.kill(pid, 0)
    throw new Error('Cancelled command survived')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
  console.log('PASS: cancellation acknowledged and command process terminated')
  const copy = await engine('copy', { computer: identity.id, requestId: 'copy-file', direction: 'toWorkspace', path: join(scratch, 'bot-file'), workspacePath: 'copied' })
  if (copy.status !== 'completed' || readFileSync(join(bot.workspace, 'copied'), 'utf8') !== 'FILE_OK') throw new Error('Workspace copy failed')
  await Bun.sleep(2000)
  const rss = Number(/^VmRSS:\s+(\d+)/m.exec(readFileSync(`/proc/${helper!.pid}/status`, 'utf8'))?.[1])
  console.log(`MEASURE: binary ${statSync(binary).size} bytes; connected helper idle RSS ${rss} KiB (Linux x64)`)
  const wrong = { ...identity, privateKey: generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }
  if ((await fetch(`${door}/helper/connect`, { headers: connectionHeaders(wrong) })).status !== 403) throw new Error('Wrong key accepted')
  // Try the consumed code in a fresh directory without revealing it in argv or logs.
  const reused = Bun.spawn([binary, 'register', door], { env: { ...env, LILBOT_HELPER_CONFIG_DIR: join(scratch, 'reused') }, stdin: 'pipe', stdout: 'ignore', stderr: 'ignore' })
  reused.stdin.write(code)
  reused.stdin.end()
  if (!(await reused.exited)) throw new Error('Code reused')
  for (const path of ['/ws', '/engine/memory/context', '/', '/api/health', '/index.html']) {
    if ((await fetch(door + path)).status !== 404) throw new Error('Door leaked a private route')
  }
  await stopHelper()
  const pinRoot = join(scratch, 'pinning')
  mkdirSync(pinRoot)
  await checkPinning(binary, pinRoot, helperConfig, identity, createPublicKey(identity.privateKey).export({ type: 'spki', format: 'pem' }).toString())
  await call('computers.remove', { computer: identity.id })
  if ((await fetch(`${door}/helper/connect`, { headers: connectionHeaders(identity) })).status !== 400) throw new Error('Removed key failed tombstone authentication')
  console.log('PASS: wrong key, consumed code, removed key and private paths refused')
} finally {
  await stopHelper()
  client?.close()
  server?.kill()
  if (server) await server.exited
  if (existsSync(join(scratch, 'lilbot.db'))) {
    const db = openDatabase(join(scratch, 'lilbot.db'))
    for (const bot of new BotStore(db).list()) {
      const deletion = deleteProfile(bot.engineBotId)
      if (await deletion.exited) process.exitCode = 1
    }
    db.close()
  }
  rmSync(scratch, { recursive: true, force: true })
}
process.exit(process.exitCode ?? 0)
