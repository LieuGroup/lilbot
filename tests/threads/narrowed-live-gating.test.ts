import { afterEach, expect, test } from 'bun:test'
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
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-r2-'))
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
    PORT: 3998,
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
  for (const name of ['Bot One', 'Bot Two', 'Bot Three']) await services.bots.createBot({ name, function: name, instructions: '' })
  const [b1, b2, b3] = services.store.list()
  const token = engineToken(join(dir, 'data'))
  const saw = (bot: { engineBotId: string }, chatId: string, tool: string, args: unknown) =>
    onTool?.({ engineBotId: bot.engineBotId, chatId, tool: `mcp__lilbot_system__${tool}`, args, callId: crypto.randomUUID() })
  const mcp = async (botId: string, name: string, args: Record<string, unknown>) => {
    const key = connectionKey(token, SYSTEM_KEY_PURPOSE, botId)
    const res = await services.system.handler(
      new Request('http://127.0.0.1:3998/engine/lilbot/mcp', {
        method: 'POST',
        headers: { host: '127.0.0.1:3998', authorization: `Bearer ${key}`, 'content-type': 'application/json' },
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
  const addHook = (botId: string, caps: WebhookCapability[], chatId: string) => {
    const hook = services.webhooks.store.create(botId, { requestId: `h-${chatId}`, description: 'H', source: 'GH', createdBy: 'oscar' }, null, 1)
    services.webhooks.store.setCapabilities(botId, hook.id, caps)
    services.threads.store.db.query("INSERT INTO webhook_runs (id, webhook_id, bot_id, created_at, status) VALUES (?, ?, ?, 1, 'running')").run(`run-${chatId}`, hook.id, botId)
    services.webhooks.store.attach(`run-${chatId}`, chatId, 2)
  }
  const enginePost = (botId: string, path: string, body: Record<string, unknown>, session?: string) => {
    const headers: Record<string, string> = {
      host: '127.0.0.1:3998',
      authorization: `Bearer ${token}`,
      'x-lilbot-bot-capability': botCapability(token, botId),
      'content-type': 'application/json'
    }
    if (session) headers['x-lilbot-session'] = session
    return services.engineApi(new Request(`http://127.0.0.1:3998${path}`, { method: 'POST', headers, body: JSON.stringify(body) }), path)
  }
  return { services, b1, b2, b3, roots, saw, mcp, addHook, enginePost }
}

test('requestId replay checks caller, mixed identical-arg calls refuse both without swapping, and raw args match trimmed/extra-key ordinary calls', async () => {
  const f = await appFixture()
  f.addHook(f.b1.id, ['delegation'], 'wh-1')
  const grpStart = { action: 'start', requestId: 'grp-secret', purpose: 'Budget', members: [f.b2.id, f.b3.id], text: 'Secret budget $999k' }
  f.saw(f.b1, 'b1-main', 'lilbot_group', grpStart)
  const grp = JSON.parse((await f.mcp(f.b1.id, 'lilbot_group', grpStart)).text)
  const delArgs = { requestId: 'del-secret', tasks: [{ to: f.b2.id, task: 'Secret task' }] }
  f.saw(f.b1, 'b1-main', 'lilbot_delegate', delArgs)
  const ex = JSON.parse((await f.mcp(f.b1.id, 'lilbot_delegate', delArgs)).text).exchanges[0]
  const redirArgs = { action: 'redirect', requestId: 'rd-secret', exchangeId: ex.exchangeId, message: 'Keep going' }
  f.saw(f.b1, 'b1-main', 'lilbot_delegation', redirArgs)
  expect((await f.mcp(f.b1.id, 'lilbot_delegation', redirArgs)).isError).toBe(false)
  await f.services.threads.ask(f.b1.id, { requestId: 'ask-secret', to: f.b2.id, text: 'Secret ask', chatId: 'b1-main' })

  // Item 1: replaying an unrestricted requestId from a narrowed session is refused across group start, delegate, redirect, and ask.
  for (const [tool, args] of [
    ['lilbot_group', { action: 'start', requestId: 'grp-secret' }],
    ['lilbot_delegate', delArgs],
    ['lilbot_delegation', redirArgs]
  ] as const) {
    f.saw(f.b1, 'wh-1', tool, args)
    const r = await f.mcp(f.b1.id, tool, args)
    expect(r.isError && r.text.includes('broader access')).toBe(true)
  }
  await expect(f.services.threads.ask(f.b1.id, { requestId: 'ask-secret', to: f.b2.id, text: 'probe', chatId: 'wh-1' })).rejects.toThrow(/broader access/)

  // Item 2: concurrent identical-arg status calls from b1-main and wh-1 refuse BOTH with clear retry text (no session swap).
  const statusArgs = { action: 'status' }
  f.saw(f.b1, 'b1-main', 'lilbot_delegation', statusArgs)
  f.saw(f.b1, 'wh-1', 'lilbot_delegation', statusArgs)
  const swap1 = await f.mcp(f.b1.id, 'lilbot_delegation', statusArgs)
  const swap2 = await f.mcp(f.b1.id, 'lilbot_delegation', statusArgs)
  expect(swap1.refused).toContain('Try again in a moment')
  expect(swap2.refused).toContain('Try again in a moment')
  f.saw(f.b1, 'b1-main', 'lilbot_delegation', statusArgs)
  const retry = await f.mcp(f.b1.id, 'lilbot_delegation', statusArgs)
  expect(retry.isError).toBe(false)
  expect(retry.refused).toBeUndefined()
  expect(retry.text).toContain(ex.exchangeId)

  // Item 3: raw pre-Zod args match immediately even with trailing newline / extra key and another unclaimed start present.
  f.saw(f.b1, 'wh-1', 'lilbot_delegation', { action: 'status', exchangeId: 'other' })
  const extraStatus = { action: 'status', note: 'checking' }
  f.saw(f.b1, 'b1-main', 'lilbot_delegation', extraStatus)
  const okExtra = await f.mcp(f.b1.id, 'lilbot_delegation', extraStatus)
  expect(okExtra.isError).toBe(false)
  expect(okExtra.text).toContain(ex.exchangeId)
  f.saw(f.b1, 'wh-1', 'lilbot_group', { action: 'status', groupId: 'other' })
  const closeNewline = { action: 'close', groupId: grp.groupId, text: 'All done.\n' }
  f.saw(f.b1, 'b1-main', 'lilbot_group', closeNewline)
  const okClose = await f.mcp(f.b1.id, 'lilbot_group', closeNewline)
  expect(okClose.isError).toBe(false)
  expect(f.services.threads.store.get(grp.groupId).group?.end?.how).toBe('closed')
})

test('zero-webhook bot gates MCP only while a local narrowed turn is live, allows matching live caps, and runs unrestricted once settled', async () => {
  const f = await appFixture()
  f.addHook(f.b1.id, ['delegation', 'memory'], 'wh-dm')
  const delivery = f.services.threads.store.accept(f.b1, f.b2, { requestId: 'live-1', text: 'work', chatId: 'wh-dm', capabilities: ['delegation', 'memory'] })
  f.services.threads.store.attach(delivery, f.b2.id, 'b2-narrow-1', true)

  // While live: tool in live caps passes immediately; concurrent mixed calls on claim() refuse both; disallowed unmatched tool & unreadable lineage fail closed.
  expect((await f.mcp(f.b2.id, 'lilbot_memory_list', {})).refused).toBeUndefined()
  f.saw(f.b2, 'b2-main', 'lilbot_delegation', { action: 'status' })
  f.saw(f.b2, 'b2-narrow-1', 'lilbot_delegation', { action: 'status' })
  const c1 = await f.mcp(f.b2.id, 'lilbot_delegation', { action: 'status' })
  const c2 = await f.mcp(f.b2.id, 'lilbot_delegation', { action: 'status' })
  expect(c1.isError && c2.isError && c1.text.includes('Try again') && c2.text.includes('Try again')).toBe(true)
  expect((await f.mcp(f.b2.id, 'lilbot_section_create', { name: 'BlockedWhileLive' })).refused).toBeDefined()
  f.roots.set('b2-unknown', null)
  expect((await f.enginePost(f.b2.id, '/engine/computers/list', {}, 'b2-unknown')).status).toBe(422)
  expect(f.services.threads.store.activeNarrowedCaps(f.b2.id)).toEqual(['delegation', 'memory'])

  // Settle: zero-webhook bot b2 is ungated on MCP and healthy chats; settled narrowed chats and unreadable lineage stay fail-closed.
  f.services.threads.store.setStatus(delivery.id, 'done')
  expect(f.services.threads.store.activeNarrowedCaps(f.b2.id)).toBeNull()
  const t0 = Date.now()
  expect((await f.mcp(f.b2.id, 'lilbot_section_create', { name: 'AfterSettle' })).refused).toBeUndefined()
  expect(Date.now() - t0).toBeLessThan(1000)
  expect((await f.enginePost(f.b2.id, '/engine/memory/recall', { botId: f.b2.id, chatId: 'b2-main', query: 'x' })).status).toBe(200)
  expect((await f.enginePost(f.b2.id, '/engine/memory/recall', { botId: f.b2.id, chatId: 'b2-unknown', query: 'x' })).status).toBe(422)
  const dNoMem = f.services.threads.store.accept(f.b1, f.b2, { requestId: 'nomem', text: 'x', chatId: 'wh-dm', capabilities: ['delegation'] })
  f.services.threads.store.attach(dNoMem, f.b2.id, 'b2-nomem', true)
  f.services.threads.store.setStatus(dNoMem.id, 'done')
  expect((await f.enginePost(f.b2.id, '/engine/memory/recall', { botId: f.b2.id, chatId: 'b2-nomem', query: 'x' })).status).toBe(422)

  // Resuming the settled exchange re-arms activeNarrowedCaps; remote workers never arm local MCP gating on zero-webhook b3.
  f.services.threads.store.accept(f.b1, f.b2, { requestId: 'resume-1', text: 'more', chatId: 'wh-dm', threadId: delivery.threadId, capabilities: ['delegation', 'memory'] })
  expect(f.services.threads.store.activeNarrowedCaps(f.b2.id)).toEqual(['delegation', 'memory'])
  f.services.threads.store.accept(f.b3, f.b3, {
    requestId: 'rw-1',
    text: 'code',
    chatId: 'b3-src',
    worker: true,
    computer: 'comp-1',
    cwd: '/work',
    capabilities: ['delegation', 'computers']
  })
  expect(f.services.threads.store.activeNarrowedCaps(f.b3.id)).toBeNull()
}, 15_000)
