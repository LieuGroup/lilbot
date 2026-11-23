import { afterEach, expect, spyOn, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppServices } from '../../server/app-services'
import { botCapability } from '../../server/bots/bot-capability'
import { connectionKey } from '../../server/connections/connection-keys'
import { engineToken } from '../../server/http/engine-api'
import { SYSTEM_KEY_PURPOSE } from '../../server/system/system-connection'
import type { WebhookCapability } from '../../shared/webhook-schema'
import { fakeService } from '../helpers/fake-engine'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

async function appFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-wh-live-'))
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
  const roots = new Map<string, string | null>()
  fake.engine.compressionRoot = (_eb, chat) => (roots.has(chat) ? roots.get(chat)! : chat)
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
  for (const name of ['Bot One', 'Bot Two']) await services.bots.createBot({ name, function: name, instructions: '' })
  const [b1, b2] = services.store.list()
  const token = engineToken(join(dir, 'data'))
  const saw = (bot: { engineBotId: string }, chatId: string, tool: string, args: unknown) =>
    onTool?.({ engineBotId: bot.engineBotId, chatId, tool: `mcp__lilbot_system__${tool}`, args, callId: crypto.randomUUID() })
  const mcp = async (botId: string, name: string, args: Record<string, unknown>) => {
    const key = connectionKey(token, SYSTEM_KEY_PURPOSE, botId)
    const res = await services.system.handler(
      new Request('http://127.0.0.1:3997/engine/lilbot/mcp', {
        method: 'POST',
        headers: { host: '127.0.0.1:3997', authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
      })
    )
    const body = (await res.json()) as { result: { content: Array<{ text: string }>; isError?: boolean } }
    const text = body.result.content[0]?.text ?? ''
    const refused = (() => {
      try {
        const p = JSON.parse(text) as { refused?: unknown }
        return typeof p.refused === 'string' ? p.refused : undefined
      } catch {
        return undefined
      }
    })()
    return { isError: Boolean(body.result.isError), refused, text }
  }
  const addRun = (botId: string, caps: WebhookCapability[], chatId: string, runId = `run-${chatId}`) => {
    const hook = services.webhooks.store.create(botId, { requestId: `h-${runId}`, description: 'H', source: 'GH', createdBy: 'oscar' }, null, 1)
    services.webhooks.store.setCapabilities(botId, hook.id, caps)
    services.threads.store.db.query("INSERT INTO webhook_runs (id, webhook_id, bot_id, created_at, status) VALUES (?, ?, ?, 1, 'running')").run(runId, hook.id, botId)
    services.webhooks.store.attach(runId, chatId, 2)
    fake.stored.add(chatId)
    return { hook, runId, finish: () => services.webhooks.store.finish(runId, 'completed', 'ok', 3) }
  }
  const enginePost = (botId: string, path: string, body: Record<string, unknown>, session?: string) => {
    const headers: Record<string, string> = {
      host: '127.0.0.1:3997',
      authorization: `Bearer ${token}`,
      'x-lilbot-bot-capability': botCapability(token, botId),
      'content-type': 'application/json'
    }
    if (session) headers['x-lilbot-session'] = session
    return services.engineApi(new Request(`http://127.0.0.1:3997${path}`, { method: 'POST', headers, body: JSON.stringify(body) }), path)
  }
  return { services, b1, b2, roots, saw, mcp, addRun, enginePost }
}

test('webhook-owning bot gates unmatched calls only while a webhook run or limited hand-off is live, and runs at 0ms when idle', async () => {
  const f = await appFixture()
  const r1 = f.addRun(f.b1.id, ['delegation', 'memory'], 'wh-1')
  const r2 = f.addRun(f.b1.id, ['memory'], 'wh-2')

  // Two live webhook runs intersect to ['memory']: memory passes without a start; tools outside ['memory'] are gated.
  const slept = spyOn(Bun, 'sleep')
  try {
    expect((await f.mcp(f.b1.id, 'lilbot_memory_list', {})).refused).toBeUndefined()
    expect(slept).not.toHaveBeenCalled()
    f.saw(f.b1, 'wh-1', 'lilbot_section_create', { name: 'BlockedHook' })
    expect((await f.mcp(f.b1.id, 'lilbot_section_create', { name: 'BlockedHook' })).refused).toContain('webhook run')
    // Deleting a webhook while its run is still 'running' keeps gating armed until that run finishes.
    f.services.webhooks.store.delete(f.b1.id, r2.hook.id)
    expect(f.services.webhooks.store.activeRunCaps(f.b1.id)).toEqual([['delegation', 'memory'], ['memory']])
    r2.finish()
    expect(f.services.webhooks.store.activeRunCaps(f.b1.id)).toEqual([['delegation', 'memory']])

    // Once all webhook runs settle: unmatched calls (e.g., engine sub-agents) pass in 0ms without sleeping.
    r1.finish()
    slept.mockClear()
    expect((await f.mcp(f.b1.id, 'lilbot_section_create', { name: 'SubagentWhileIdle' })).refused).toBeUndefined()
    expect((await f.mcp(f.b1.id, 'lilbot_work_list', { mine: false })).refused).toBeUndefined()
    expect(slept).not.toHaveBeenCalled()

    // Named-session routes and reported MCP calls from the settled webhook chat or its compressed child stay refused forever.
    f.roots.set('wh-1-child', 'wh-1')
    expect((await f.enginePost(f.b1.id, '/engine/computers/list', {}, 'wh-1')).status).toBe(422)
    expect((await f.enginePost(f.b1.id, '/engine/computers/list', {}, 'wh-1-child')).status).toBe(422)
    expect((await f.enginePost(f.b1.id, '/engine/computers/list', {}, 'b1-main')).status).toBe(200)
    f.saw(f.b1, 'wh-1-child', 'lilbot_section_create', { name: 'SettledProbe' })
    expect((await f.mcp(f.b1.id, 'lilbot_section_create', { name: 'SettledProbe' })).refused).toContain('webhook run')

    // Browser openRun and openChat cannot send new messages into a settled webhook run session.
    const openedRun = await f.services.webhooks.openRun(f.b1.id, r1.runId, () => {})
    await expect(openedRun.send('continue')).rejects.toThrow('cannot be continued')
    openedRun.close()
    const openedChat = await f.services.bots.openChat(f.b1.id, 'wh-1', () => {}, true)
    await expect(openedChat.send('continue')).rejects.toThrow('cannot be continued')
    openedChat.close()

    // Reply or notice delivery addressed to the settled webhook session immediately re-arms live gating until it settles.
    const ex = f.services.threads.store.accept(f.b1, f.b2, { requestId: 'ex-from-wh', text: 'check', chatId: 'wh-1', capabilities: ['delegation'] })
    f.services.threads.store.setStatus(ex.id, 'done')
    f.services.threads.store.enqueue('ans-wh', ex.threadId, f.b2.id, f.b1.id, 'wh-1', 'done', 'answer')
    f.saw(f.b1, 'wh-1', 'lilbot_section_create', { name: 'DuringAnswer' })
    expect((await f.mcp(f.b1.id, 'lilbot_section_create', { name: 'DuringAnswer' })).refused).toContain('webhook run')
    // Unmatched call while reply to wh-1 is live is gated (stalls and refuses).
    expect((await f.mcp(f.b1.id, 'lilbot_section_create', { name: 'UnmatchedDuringAnswer' })).refused).toContain('webhook run')
    f.services.threads.store.setStatus('ans-wh', 'done')
    slept.mockClear()
    expect((await f.mcp(f.b1.id, 'lilbot_section_create', { name: 'AfterAnswerSettled' })).refused).toBeUndefined()
    expect(slept).not.toHaveBeenCalled()
  } finally {
    slept.mockRestore()
  }
}, 15_000)
