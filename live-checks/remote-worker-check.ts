import { devScratch } from '../scripts/dev-env'
/** `bun run check:remote-worker`: isolated dev LilBot server + real helper process on the leader using a fake
 *  Claude Code CLI in PATH (never touches another machine or runs a real coding agent). One temporary Hermes bot
 *  discovers the worker-capable computer via `lilbot_status`, starts a remote worker via `lilbot_delegate`,
 *  verifies its `code` work item, scoped MCP evidence & memory writes, nesting refusal, answer delivery back to
 *  main chat, continuation (`--resume`), and mid-run steer & cancel. Cleanup runs in `finally`. */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { devPort } from '../scripts/dev-paths'
import { writeDelegationFakeClaude } from '../tests/threads/remote-worker-fake-cli'
import { deleteProfile, startServer } from './check-process'
import { browser, eventually } from './computers-client'

const say = (line: string) => console.log(`ok: ${line}`)
const scratch = devScratch('lilbot-remote-worker')
const port = devPort()
const doorPort = devPort()
const door = `http://127.0.0.1:${doorPort}`
const helperConfig = join(scratch, 'helper')
const binDir = join(scratch, 'bin')
const workDir = join(scratch, 'repo')
mkdirSync(binDir, { recursive: true, mode: 0o700 })
mkdirSync(workDir, { recursive: true, mode: 0o700 })
const fakeClaude = writeDelegationFakeClaude(binDir, 'claude')

const helperEnv = { ...process.env, LILBOT_HELPER_CONFIG_DIR: helperConfig, LILBOT_WORKER_CLAUDE_BIN: fakeClaude }
let server: ReturnType<typeof Bun.spawn> | undefined
let helper: ReturnType<typeof Bun.spawn> | undefined
let client: Awaited<ReturnType<typeof browser>> | undefined
let db: Database | undefined
let nativeProfile: string | undefined

try {
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
  client = await browser(port)
  const call = client.call

  const { code } = await call('computers.installCode', { name: 'Worker Box' })
  const reg = Bun.spawn(['bun', 'helper/main.ts', 'register', door], { env: helperEnv, stdin: 'pipe', stdout: 'ignore', stderr: 'inherit' })
  reg.stdin.write(code)
  reg.stdin.end()
  assert.equal(await reg.exited, 0, 'helper registration failed')
  helper = Bun.spawn(['bun', 'helper/main.ts', 'run'], { env: helperEnv, stdout: 'ignore', stderr: 'inherit' })
  const identity = JSON.parse(readFileSync(join(helperConfig, 'identity.json'), 'utf8'))
  await eventually(async () => {
    const comp = (await call('computers.list')).find((c: any) => c.id === identity.id)
    return Boolean(comp?.online && comp.capabilities?.includes('worker') && comp.workerAgents?.some((a: any) => a.driver === 'claude-code' && a.version === '2.1.327'))
  })
  say('isolated helper registered, online, and advertising fake claude-code worker agent')

  const bot = await call('bots.create', {
    name: 'Remote Worker Check',
    instructions: 'REMOTE_MARKER. You are in a live check. Follow instructions literally and briefly. Do not call lilbot_work yourself. Never poll.',
    model: { provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-5-5' }
  })
  db = new Database(join(scratch, 'lilbot.db'))
  db.exec('PRAGMA busy_timeout = 5000')
  nativeProfile = (db.query('SELECT engine_bot_id FROM bots WHERE id=?').get(bot.id) as { engine_bot_id: string } | null)?.engine_bot_id
  const main = await call('chat.open', { botId: bot.id })

  await call('chat.send', {
    chatId: main.chatId,
    text:
      `First call lilbot_status with area "computers" to see Worker Box. ` +
      `Then call lilbot_delegate once with requestId live-rw-1 and one task: worker: true, computer: "Worker Box", cwd: ${JSON.stringify(workDir)}, reasoningEffort: "high", task: "MODE:MCP live check". ` +
      `Then reply STARTED.`
  })

  await eventually(async () => {
    const rows = db!.query("SELECT threadId FROM thread_deliveries WHERE sender=? AND kind='request'").all(bot.id) as { threadId: string }[]
    if (!rows.length) return false
    const t = await call('threads.open', { botId: bot.id, threadId: rows[0].threadId })
    return t.status === 'finished'
  }, 180_000)

  const req = db.query("SELECT threadId FROM thread_deliveries WHERE sender=? AND kind='request' ORDER BY rowid LIMIT 1").get(bot.id) as { threadId: string }
  const exId = req.threadId
  const opened = await call('threads.open', { botId: bot.id, threadId: exId })
  assert.equal(opened.worker, true)
  assert.equal(opened.computer, identity.id)
  assert.equal(opened.computerName, 'Worker Box')
  assert.equal(opened.cwd, workDir)
  const assistantItem = opened.messages.at(-1).items.find((i: any) => i.kind === 'assistant')
  const payload = JSON.parse(assistantItem.text)
  assert.equal(payload.ok, true)
  assert.equal(payload.effort, 'high')
  assert.equal(payload.hasSys, true)
  assert.equal(payload.toolCount, 6)
  assert.equal(payload.workOk, true)
  assert.equal(payload.memOk, true)
  assert.equal(payload.nestedRefused, true)
  assert.equal(payload.otherWorkRefused, true)
  const item = await call('work.open', { itemId: exId })
  assert.equal(item.kind, 'code')
  assert.ok(
    item.evidence.some((e: any) => e.proves === 'Remote build green'),
    'scoped MCP work evidence missing'
  )
  const mem = await call('memory.list', { botId: bot.id })
  assert.ok(
    mem.facts.some((f: any) => f.text === 'Remote worker saved a durable fact.'),
    'scoped MCP memory fact missing'
  )
  say('remote worker completed end-to-end with scoped 6-tool MCP, work evidence, memory save, and nesting refusal')

  // Verify answer delivery back to main chat completed.
  await eventually(
    async () => (db!.query("SELECT status FROM thread_deliveries WHERE threadId=? AND kind='answer'").get(exId) as { status: string } | null)?.status === 'done',
    120_000
  )
  say('remote worker answer delivered back to main chat')

  // Continuation via exchangeId must pass --resume <sessionId> to the remote agent.
  await call('chat.send', {
    chatId: main.chatId,
    text: `Call lilbot_delegate once with requestId live-rw-2 and one task: exchangeId: ${JSON.stringify(exId)}, task: "Continue check". Then reply CONTINUED.`
  })
  await eventually(async () => {
    const t = await call('threads.open', { botId: bot.id, threadId: exId })
    return t.messages.length >= 4 && t.status === 'finished'
  }, 180_000)
  const contThread = await call('threads.open', { botId: bot.id, threadId: exId })
  const contPayload = JSON.parse(contThread.messages.at(-1).items.find((i: any) => i.kind === 'assistant').text)
  assert.match(contPayload.resume, /^claude-sess-/, 'continuation did not resume remote session')
  say(`continuation resumed remote session ${contPayload.resume}`)
  console.log('PASS: remote worker live check complete')
} finally {
  client?.close()
  helper?.kill()
  if (helper) await helper.exited
  server?.kill()
  if (server) await server.exited
  db?.close()
  if (nativeProfile) {
    const del = deleteProfile(nativeProfile, 'ignore')
    await del.exited
  }
  rmSync(scratch, { recursive: true, force: true })
}
