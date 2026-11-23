import { afterEach, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppServices } from '../../server/app-services'
import { connectionKey } from '../../server/connections/connection-keys'
import { engineToken } from '../../server/http/engine-api'
import { SYSTEM_KEY_PURPOSE } from '../../server/system/system-connection'
import { workRunOptions } from '../../server/threads/thread-prompts'
import { webhookRunAccess } from '../../server/webhooks/webhook-access'
import type { WebhookCapability } from '../../shared/webhook-schema'
import { fakeService } from '../helpers/fake-engine'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

async function setupApp() {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-eng-narrow-'))
  const prevSkills = process.env.LILBOT_SKILLS_DIR
  process.env.LILBOT_SKILLS_DIR = join(dir, 'skills')
  mkdirSync(join(dir, 'skills'), { recursive: true })
  const origSetInterval = globalThis.setInterval
  ;(globalThis as { setInterval: typeof setInterval }).setInterval = (() => 0) as unknown as typeof setInterval
  const fake = fakeService()
  let onTool: ((call: { engineBotId: string; chatId: string; tool: string; args: unknown; callId?: string }) => void) | undefined
  fake.engine.onToolCall = cb => {
    onTool = cb
    return () => {}
  }
  const services = createAppServices(fake.engine, {
    DATA_DIR: join(dir, 'data'),
    WORKSPACES_DIR: join(dir, 'ws'),
    PORT: 3997,
    MEMORY_ADAPTER_VERSION: '0.14.0',
    COMMIT: 'test',
    HOOK_ORIGIN: undefined,
    ACCESS_HOST: undefined,
    publish: () => {},
    botsChanged: () => {}
  })
  globalThis.setInterval = origSetInterval
  cleanups.push(() => {
    services.computers.close()
    services.remoteWorkers.runner.close()
    rmSync(dir, { recursive: true, force: true })
    rmSync(fake.root, { recursive: true, force: true })
    if (prevSkills === undefined) delete process.env.LILBOT_SKILLS_DIR
    else process.env.LILBOT_SKILLS_DIR = prevSkills
  })
  await services.bots.createBot({ name: 'Dev Bot', function: 'Code', instructions: '' })
  const bot = services.store.list()[0]
  services.store.save({ ...bot, model: { provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-5-5' } })
  const pair = generateKeyPairSync('ed25519')
  const compId = 'comp-studio'
  services.computers.store.add(
    compId,
    {
      name: 'Studio',
      os: 'linux',
      home: dir,
      capabilities: ['exec', 'worker'],
      workerAgents: [
        { driver: 'claude-code', version: '2.1.330', supported: true, signedIn: true },
        { driver: 'hermes', version: '0.23.1', supported: false, signedIn: true }
      ]
    },
    pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  )
  services.computers.connect(
    compId,
    () => {},
    () => {}
  )

  const token = engineToken(join(dir, 'data'))
  const saw = (chatId: string, tool: string, args: unknown) =>
    onTool?.({ engineBotId: bot.engineBotId, chatId, tool: `mcp__lilbot_system__${tool}`, args, callId: crypto.randomUUID() })
  const mcp = async (name: string, args: Record<string, unknown>) => {
    const key = connectionKey(token, SYSTEM_KEY_PURPOSE, bot.id)
    const res = await services.system.handler(
      new Request('http://127.0.0.1:3997/engine/lilbot/mcp', {
        method: 'POST',
        headers: { host: '127.0.0.1:3997', authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
      })
    )
    const body = (await res.json()) as { result: { content: Array<{ text: string }>; isError?: boolean } }
    return { isError: Boolean(body.result.isError), text: body.result.content[0]?.text ?? '' }
  }
  const addHook = (caps: WebhookCapability[], chatId: string) => {
    const hook = services.webhooks.store.create(bot.id, { requestId: `h-${chatId}`, description: 'H', source: 'GH', createdBy: 'oscar' }, null, 1)
    services.webhooks.store.setCapabilities(bot.id, hook.id, caps)
    services.threads.store.db.query("INSERT INTO webhook_runs (id, webhook_id, bot_id, created_at, status) VALUES (?, ?, ?, 1, 'running')").run(`run-${chatId}`, hook.id, bot.id)
    services.webhooks.store.attach(`run-${chatId}`, chatId, 2)
  }
  return { dir, services, bot, compId, saw, mcp, addHook }
}

test('MCP delegate with engine matches raw args, validates engine, refuses limited runs without computers, and preserves engine on repeated requestId', async () => {
  const f = await setupApp()
  f.addHook(['delegation'], 'wh-no-comp')
  f.addHook(['delegation', 'computers'], 'wh-with-comp')

  // Raw pre-Zod args (with extra key + untrimmed task + engine) match via systemSessionRefusal + callingChat.
  const rawMain = {
    requestId: 'req-eng-1',
    extraNote: 'unstripped',
    tasks: [{ worker: true, computer: 'Studio', cwd: '/tmp', engine: 'claude-code', task: '  Build module  \n' }]
  }
  f.saw('b1-main', 'lilbot_delegate', rawMain)
  const okMain = await f.mcp('lilbot_delegate', rawMain)
  expect(okMain.isError).toBe(false)
  const exId = JSON.parse(okMain.text).exchanges[0].exchangeId as string
  expect(f.services.threads.store.get(exId).workerEngine).toBe('claude-code')

  // Invalid engine value fails validation before any task is accepted.
  const badArgs = { requestId: 'req-bad-eng', tasks: [{ worker: true, computer: 'Studio', cwd: '/tmp', engine: 'invalid-engine', task: 'Hi' }] }
  f.saw('b1-main', 'lilbot_delegate', badArgs)
  expect((await f.mcp('lilbot_delegate', badArgs)).isError).toBe(true)

  // Repeated requestId with a DIFFERENT engine (even unsupported) does not change the existing task's engine.
  const replayDiffEngine = {
    requestId: 'req-eng-1',
    tasks: [{ worker: true, computer: 'Studio', cwd: '/tmp', engine: 'hermes', task: '  Build module  \n' }]
  }
  f.saw('b1-main', 'lilbot_delegate', replayDiffEngine)
  const replayed = await f.mcp('lilbot_delegate', replayDiffEngine)
  expect(replayed.isError).toBe(false)
  expect(JSON.parse(replayed.text).exchanges[0].engine).toBe('claude-code')
  expect(f.services.threads.store.get(exId).workerEngine).toBe('claude-code')

  // Narrowed run without `computers` cannot replay an unrestricted remote worker's requestId (same or different engine).
  f.saw('wh-no-comp', 'lilbot_delegate', replayDiffEngine)
  const replayNarrow = await f.mcp('lilbot_delegate', replayDiffEngine)
  expect(replayNarrow.isError).toBe(true)
  expect(replayNarrow.text).toMatch(/"computers"|broader access/)

  // Narrowed run without `computers` refuses computer+engine (even nonexistent box / unsupported engine) AND bare engine before resolveRemoteWorker.
  for (const args of [
    { requestId: 'nw-1', tasks: [{ worker: true, computer: 'NoSuchBox', cwd: '/tmp', engine: 'codex', task: 'Probe' }] },
    { requestId: 'nw-2', tasks: [{ worker: true, computer: 'Studio', cwd: '/tmp', engine: 'claude-code', task: 'Run' }] },
    { requestId: 'nw-3', tasks: [{ worker: true, engine: 'claude-code', task: 'Bare engine probe' }] }
  ]) {
    f.saw('wh-no-comp', 'lilbot_delegate', args)
    const r = await f.mcp('lilbot_delegate', args)
    expect(r.isError).toBe(true)
    expect(r.text).toContain('"computers"')
  }

  // Narrowed run WITH `['delegation', 'computers']` succeeds and carries both workerEngine and narrowed capabilities into workRunOptions.
  const okNarrowArgs = { requestId: 'nw-ok', tasks: [{ worker: true, computer: 'Studio', cwd: '/tmp', engine: 'claude-code', task: 'Scoped run' }] }
  f.saw('wh-with-comp', 'lilbot_delegate', okNarrowArgs)
  const okNarrow = await f.mcp('lilbot_delegate', okNarrowArgs)
  expect(okNarrow.isError).toBe(false)
  const narrowThread = f.services.threads.store.get(JSON.parse(okNarrow.text).exchanges[0].exchangeId)
  expect(narrowThread.workerEngine).toBe('claude-code')
  expect(narrowThread.capabilities).toEqual(['computers', 'delegation'])
  const runOpts = workRunOptions(narrowThread, true, undefined, caps => webhookRunAccess(caps, false))
  expect(runOpts).toMatchObject({ computer: f.compId, cwd: '/tmp', engine: 'claude-code', capabilities: ['computers', 'delegation'] })

  // runForBot enforces computers capability and full-access mode BEFORE engine selection (even for unsupported engine).
  const noCompRun = await f.services.remoteWorkers.runForBot(f.bot.id, 'hi', {
    runId: 'rfb-1',
    threadId: narrowThread.id,
    computer: f.compId,
    cwd: '/tmp',
    engine: 'codex',
    capabilities: ['delegation'],
    onChat: () => {}
  })
  expect(noCompRun.text).toContain('without the computers capability')

  f.services.threads.store.db.query("UPDATE bots SET permission_mode='ask' WHERE id=?").run(f.bot.id)
  await expect(f.services.remoteWorkers.resolveRemoteWorker(f.bot.id, { computer: 'Studio', cwd: '/tmp', engine: 'codex' })).rejects.toThrow(/full-access/)
  const noFullRun = await f.services.remoteWorkers.runForBot(f.bot.id, 'hi', {
    runId: 'rfb-2',
    threadId: narrowThread.id,
    computer: f.compId,
    cwd: '/tmp',
    engine: 'codex',
    capabilities: ['delegation', 'computers'],
    onChat: () => {}
  })
  expect(noFullRun.text).toContain('full-access')
})
