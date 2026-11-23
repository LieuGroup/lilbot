import { devScratch } from '../scripts/dev-env'
/** `bun run check:remote-worker-hermes`: isolated dev LilBot server + real helper process driving a REAL Hermes
 *  gateway on a throwaway HERMES_HOME (cold start + unmanaged --idle-exit). Covers: start, AGENTS.md read,
 *  file edit, scoped MCP memory save, mid-run steer, mid-run stop, dropped helper link + session resume with
 *  rotated MCP proxy, unchanged Hermes config.yaml, and automatic gateway idle exit. Cleanup runs in `finally`. */
import { Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { devPort } from '../scripts/dev-paths'
import { deleteProfile, startServer } from './check-process'
import { browser, eventually } from './computers-client'

const say = (line: string) => console.log(`ok: ${line}`)
const scratch = devScratch('lilbot-remote-worker-hermes')
const [port, doorPort] = [devPort(), devPort()]
const door = `http://127.0.0.1:${doorPort}`
const [helperConfig, workDir, remoteHome, remoteLocks] = ['helper', 'repo', 'remote-hermes', 'remote-hermes-locks'].map(name => join(scratch, name))
const devHermes = join(homedir(), 'lilbot-dev', 'hermes')
for (const dir of [helperConfig, workDir, remoteHome, remoteLocks]) mkdirSync(dir, { recursive: true, mode: 0o700 })

const baseCfg = readFileSync(join(devHermes, 'config.yaml'), 'utf8')
const remoteCfg = baseCfg.replace(/gateway:\n(?:\s+.*\n)*/, 'gateway:\n  multiplex_profiles: false\n  unmanaged_idle_exit_seconds: 8\n')
writeFileSync(join(remoteHome, 'config.yaml'), remoteCfg, { mode: 0o600 })
copyFileSync(join(devHermes, '.env'), join(remoteHome, '.env'))
chmodSync(join(remoteHome, '.env'), 0o600)
if (existsSync(join(devHermes, 'installs'))) symlinkSync(join(devHermes, 'installs'), join(remoteHome, 'installs'))
writeFileSync(join(workDir, 'AGENTS.md'), '# Test Repo\nAlways include the exact marker REPO_GUIDE_OK in any file you create.\n')

const helperEnv = { ...process.env, LILBOT_HELPER_CONFIG_DIR: helperConfig, HERMES_HOME: remoteHome, HERMES_GATEWAY_LOCK_DIR: remoteLocks, LILBOT_WORKER_CLAUDE_BIN: '' }
const readPid = () => {
  try {
    const pid = (JSON.parse(readFileSync(join(remoteHome, 'gateway.pid'), 'utf8')) as { pid?: unknown }).pid
    return typeof pid === 'number' ? pid : null
  } catch {
    return null
  }
}
const pidAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

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
  await eventually(
    () =>
      fetch(`http://127.0.0.1:${port}/api/health`).then(
        r => r.ok,
        () => false
      ),
    30_000
  )
  say('dev server healthy')
  client = await browser(port)
  const call = client.call

  const { code } = await call('computers.installCode', { name: 'Hermes Box' })
  const reg = Bun.spawn(['bun', 'helper/main.ts', 'register', door], { env: helperEnv, stdin: 'pipe', stdout: 'ignore', stderr: 'inherit' })
  reg.stdin.write(code)
  reg.stdin.end()
  assert.equal(await reg.exited, 0, 'helper registration failed')
  helper = Bun.spawn(['bun', 'helper/main.ts', 'run'], { env: helperEnv, stdout: 'ignore', stderr: 'inherit' })
  const identity = JSON.parse(readFileSync(join(helperConfig, 'identity.json'), 'utf8'))
  await eventually(async () => {
    const comp = (await call('computers.list')).find((c: any) => c.id === identity.id)
    return Boolean(comp?.online && comp.capabilities?.includes('worker') && comp.workerAgents?.some((a: any) => a.driver === 'hermes' && a.supported === true))
  }, 30_000)
  say('helper registered, online, and advertising supported Hermes engine')

  const bot = await call('bots.create', {
    name: 'Hermes Remote Check',
    instructions: 'You are in a live check. Follow instructions literally and briefly. Do not call lilbot_work yourself unless asked. Never poll.',
    model: { provider: 'cliproxyapi', model: 'anthropic/claude-haiku-5-5' }
  })
  db = new Database(join(scratch, 'lilbot.db'))
  db.exec('PRAGMA busy_timeout = 5000')
  nativeProfile = (db.query('SELECT engine_bot_id FROM bots WHERE id=?').get(bot.id) as { engine_bot_id: string } | null)?.engine_bot_id
  const main = await call('chat.open', { botId: bot.id })

  await call('chat.send', {
    chatId: main.chatId,
    text:
      `Call lilbot_delegate once with requestId live-rh-1 and two tasks on computer "Hermes Box" in cwd ${JSON.stringify(workDir)}: ` +
      `Task 1: worker: true, computer: "Hermes Box", cwd: ${JSON.stringify(workDir)}, task: "First run \`sleep 20\` in the foreground in terminal (do not background it). Then read AGENTS.md in your working directory, write file proof.txt containing HERMES_EDIT_OK and the marker from AGENTS.md, call lilbot_memory_save with fact 'Hermes remote worker saved this fact.' (scope bot), and reply with DONE_W1 plus any redirected token. Do not call lilbot_work." ` +
      `Task 2: worker: true, computer: "Hermes Box", cwd: ${JSON.stringify(workDir)}, task: "Run \`sleep 120\` in the foreground in terminal (do not background it), then reply DONE_W2. Do not call lilbot_work." ` +
      `Then reply STARTED.`
  })

  await eventually(async () => (db!.query("SELECT count(*) AS n FROM thread_deliveries WHERE sender=? AND kind='request'").get(bot.id) as { n: number }).n === 2, 120_000)
  const reqs = db.query("SELECT threadId FROM thread_deliveries WHERE sender=? AND kind='request' ORDER BY rowid").all(bot.id) as { threadId: string }[]
  const openedList = await Promise.all(reqs.map(r => call('threads.open', { botId: bot.id, threadId: r.threadId })))
  const w1 = openedList.find(t => String(t.messages[0]?.items?.[0]?.text ?? '').includes('proof.txt'))!.id as string
  const w2 = openedList.find(t => t.id !== w1)!.id as string

  await eventually(async () => {
    const [a, b] = await Promise.all([call('threads.open', { botId: bot.id, threadId: w1 }), call('threads.open', { botId: bot.id, threadId: w2 })])
    return a.status === 'working' && b.status === 'working' && Boolean(a.activity) && Boolean(b.activity)
  }, 120_000)
  say('both real Hermes remote workers booted cold gateway and entered working state')

  await call('chat.send', {
    chatId: main.chatId,
    text:
      `Worker 1 is ${w1}, Worker 2 is ${w2}. In this order: ` +
      `1) call lilbot_delegation action redirect on ${w1} with requestId live-rh-steer and message "Also include STEER_OK in your final reply."; ` +
      `2) call lilbot_delegation action cancel on ${w2}. Then reply CONTROL_OK.`
  })
  await eventually(async () => {
    const redir = db!.query('SELECT status FROM thread_deliveries WHERE id=?').get(`${bot.id}:live-rh-steer`) as { status: string } | null
    const t2 = await call('threads.open', { botId: bot.id, threadId: w2 })
    return redir?.status === 'steered' && t2.status === 'cancelled'
  }, 120_000)
  say('steered Hermes worker 1 mid-run and stopped Hermes worker 2 mid-run')

  await eventually(async () => (await call('threads.open', { botId: bot.id, threadId: w1 })).status === 'finished', 180_000)
  const done1 = await call('threads.open', { botId: bot.id, threadId: w1 })
  assert.equal(done1.workerEngine, 'hermes')
  const proofPath = join(workDir, 'proof.txt')
  assert.ok(existsSync(proofPath), 'proof.txt was not created by Hermes worker')
  const proofBody = readFileSync(proofPath, 'utf8')
  assert.ok(proofBody.includes('HERMES_EDIT_OK') && proofBody.includes('REPO_GUIDE_OK'), `unexpected proof.txt: ${proofBody}`)
  const mem = await call('memory.list', { botId: bot.id })
  assert.ok(
    mem.facts.some((f: any) => f.text.includes('Hermes remote worker saved this fact')),
    'scoped MCP memory fact missing'
  )
  const reply1 = done1.messages
    .at(-1)
    .items.map((i: any) => i.text ?? '')
    .join('\n')
  assert.ok(reply1.includes('STEER_OK'), `steer token missing from reply: ${reply1.slice(0, 200)}`)
  say('worker 1 completed with file edit, AGENTS.md marker, scoped MCP memory save, and steered reply')

  // Drop helper link (restart helper) and resume the same Hermes session via exchangeId continuation.
  helper.kill()
  await helper.exited
  await eventually(async () => !(await call('computers.list')).find((c: any) => c.id === identity.id)?.online, 20_000)
  helper = Bun.spawn(['bun', 'helper/main.ts', 'run'], { env: helperEnv, stdout: 'ignore', stderr: 'inherit' })
  await eventually(async () => Boolean((await call('computers.list')).find((c: any) => c.id === identity.id)?.online), 30_000)
  say('helper link dropped and reconnected')

  await call('chat.send', {
    chatId: main.chatId,
    text: `Call lilbot_delegate once with requestId live-rh-resume and one task: exchangeId: ${JSON.stringify(w1)}, task: "Reply with RESUME_OK and the exact word you wrote into proof.txt. Do not call lilbot_work." Then reply RESUMED.`
  })
  await eventually(async () => {
    const t = await call('threads.open', { botId: bot.id, threadId: w1 })
    return t.messages.length >= 4 && t.status === 'finished'
  }, 180_000)
  const resumed = await call('threads.open', { botId: bot.id, threadId: w1 })
  const reply2 = resumed.messages
    .at(-1)
    .items.map((i: any) => i.text ?? '')
    .join('\n')
  assert.ok(reply2.includes('RESUME_OK') && reply2.includes('HERMES_EDIT_OK'), `resumed reply missing tokens: ${reply2.slice(0, 200)}`)
  say('resumed Hermes worker session after dropped helper link')

  assert.equal(readFileSync(join(remoteHome, 'config.yaml'), 'utf8'), remoteCfg, 'remote Hermes config.yaml was modified!')
  assert.equal(readFileSync(join(devHermes, 'config.yaml'), 'utf8'), baseCfg, 'dev Hermes config.yaml was modified!')
  const gwPid = readPid()
  helper.kill()
  await helper.exited
  helper = undefined
  if (gwPid) {
    await eventually(async () => !pidAlive(gwPid), 30_000)
    say(`unmanaged Hermes gateway (pid ${gwPid}) exited automatically after idle`)
  }
  console.log('PASS: real Hermes remote worker live check complete')
} finally {
  client?.close()
  helper?.kill()
  if (helper) await helper.exited
  const leftover = readPid()
  if (leftover && pidAlive(leftover))
    try {
      process.kill(leftover, 'SIGTERM')
    } catch {}
  server?.kill()
  if (server) await server.exited
  db?.close()
  if (nativeProfile) await deleteProfile(nativeProfile, 'ignore').exited
  rmSync(scratch, { recursive: true, force: true })
}
