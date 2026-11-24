import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppServices } from '../../server/app-services'
import { botCapability } from '../../server/bots/bot-capability'
import { connectionKey } from '../../server/connections/connection-keys'
import { engineToken } from '../../server/http/engine-api'
import { SYSTEM_KEY_PURPOSE } from '../../server/system/system-connection'
import { fakeService } from '../helpers/fake-engine'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function bootApp(dir: string, roots: Map<string, string | null>, fake: ReturnType<typeof fakeService>) {
  const intervals: ReturnType<typeof setInterval>[] = []
  const origSetInterval = globalThis.setInterval
  ;(globalThis as { setInterval: typeof setInterval }).setInterval = ((...args: Parameters<typeof setInterval>) => {
    const id = origSetInterval(...args)
    intervals.push(id)
    return id
  }) as typeof setInterval
  try {
    fake.engine.compressionRoot = (_eb, chat) => (roots.has(chat) ? roots.get(chat)! : chat)
    const services = createAppServices(fake.engine, {
      DATA_DIR: join(dir, 'data'),
      WORKSPACES_DIR: join(dir, 'ws'),
      PORT: 3997,
      MEMORY_ADAPTER_VERSION: '0.15.0',
      COMMIT: 'test',
      HOOK_ORIGIN: undefined,
      ACCESS_HOST: undefined,
      publish: () => {},
      botsChanged: () => {}
    })
    cleanups.push(() => {
      for (const id of intervals) clearInterval(id)
      services.computers.close()
      services.remoteWorkers.runner.close()
    })
    return services
  } finally {
    globalThis.setInterval = origSetInterval
  }
}

test('review sessions run on scoped MCP, protect owner facts, lock skills/hooks across restarts and continuations, and never block main chat', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-rev-iso-'))
  const prevSkills = process.env.LILBOT_SKILLS_DIR
  process.env.LILBOT_SKILLS_DIR = join(dir, 'skills')
  mkdirSync(join(dir, 'skills'), { recursive: true })
  const fake = fakeService()
  const roots = new Map<string, string | null>()
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(fake.root, { recursive: true, force: true })
    if (prevSkills === undefined) delete process.env.LILBOT_SKILLS_DIR
    else process.env.LILBOT_SKILLS_DIR = prevSkills
  })

  const services = bootApp(dir, roots, fake)
  await services.bots.createBot({ name: 'Iso Bot', function: 'Testing', instructions: '' })
  const [bot] = services.store.list()
  const token = engineToken(join(dir, 'data'))
  const ownerFact = await services.bots.writeMemory({ botId: bot.id, kind: 'profile', scope: 'bot', text: 'Owner written standing rule.' })

  let reviewConnUrl = ''
  let reviewToken = ''
  const reviewChat = 'rev-root-1'
  const reviewCont = 'rev-cont-2'
  roots.set(reviewCont, reviewChat)

  fake.engine.reviewMemory = async (_nativeId, _prompt, options) => {
    const conn = options.sessionMcp![0]
    reviewConnUrl = conn.url
    reviewToken = conn.bearerToken
    const post = (body: unknown) =>
      services.system.scoped!(
        new Request(conn.url, {
          method: 'POST',
          headers: { host: '127.0.0.1:3997', authorization: `Bearer ${conn.bearerToken}`, 'content-type': 'application/json' },
          body: JSON.stringify(body)
        }),
        new URL(conn.url).pathname
      )

    // 1. tools/list advertises strictly the 3 review memory tools (zero skills or other tools).
    const listed = ((await (await post({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })).json()) as any).result.tools.map((t: any) => t.name)
    expect(listed.sort()).toEqual(['lilbot_memory_forget', 'lilbot_memory_recall', 'lilbot_memory_save'])
    options.assertSessionMcpReady?.()
    options.onChat(reviewChat)

    // 2. Concurrent ordinary main-chat call runs on /engine/lilbot/mcp with zero gate interference.
    const mainSave = await services.system.handler(
      new Request('http://127.0.0.1:3997/engine/lilbot/mcp', {
        method: 'POST',
        headers: { host: '127.0.0.1:3997', authorization: `Bearer ${connectionKey(token, SYSTEM_KEY_PURPOSE, bot.id)}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 10,
          method: 'tools/call',
          params: { name: 'lilbot_memory_save', arguments: { kind: 'profile', text: 'Saved from live main chat.' } }
        })
      })
    )
    expect(mainSave.status).toBe(200)
    expect(JSON.parse(((await mainSave.json()) as any).result.content[0].text).via).toBe('chat')

    // 3. Review cannot forget owner-authored fact, but can save a review fact (via: 'review').
    const forgetOwner = (await (
      await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'lilbot_memory_forget', arguments: { id: ownerFact.id } } })
    ).json()) as any
    expect(forgetOwner.result.isError).toBe(true)
    expect(forgetOwner.result.content[0].text).toContain('The user wrote this fact')

    const revSave = (await (
      await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'lilbot_memory_save', arguments: { kind: 'profile', text: 'Review saved fact.' } } })
    ).json()) as any
    expect(revSave.result.isError).toBeUndefined()
    expect(JSON.parse(revSave.result.content[0].text).via).toBe('review')
  }

  const saveRes = await services.engineApi(
    new Request('http://127.0.0.1:3997/engine/history/save', {
      method: 'POST',
      headers: { host: '127.0.0.1:3997', authorization: `Bearer ${token}`, 'x-lilbot-bot-capability': botCapability(token, bot.id) },
      body: JSON.stringify({ chatId: 'main-1', messages: [{ role: 'user', text: 'Remember this.' }] })
    }),
    '/engine/history/save'
  )
  expect(saveRes.status).toBe(200)

  // 4. Once settled, the review bearer token is immediately revoked (403).
  const afterSettle = await services.system.scoped!(
    new Request(reviewConnUrl, {
      method: 'POST',
      headers: { host: '127.0.0.1:3997', authorization: `Bearer ${reviewToken}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} })
    }),
    new URL(reviewConnUrl).pathname
  )
  expect(afterSettle.status).toBe(403)

  // 5. Simulate a full LilBot restart on the same SQLite database: review chat AND its compression continuation stay hidden,
  //    locked out of /engine/skills/write, skipped by /engine/history/save, and ignored by /engine/memory/turn.
  const restarted = bootApp(dir, roots, fake)
  const cap = botCapability(token, bot.id)
  const postEngine = (path: string, body: Record<string, unknown>, session?: string) =>
    restarted.engineApi(
      new Request(`http://127.0.0.1:3997${path}`, {
        method: 'POST',
        headers: { host: '127.0.0.1:3997', authorization: `Bearer ${token}`, 'x-lilbot-bot-capability': cap, ...(session ? { 'x-lilbot-session': session } : {}) },
        body: JSON.stringify(body)
      }),
      path
    )

  for (const chat of [reviewChat, reviewCont]) {
    expect(restarted.hiddenChat(bot.id, chat)).toBe(true)
    const skillWrite = await postEngine('/engine/skills/write', { name: 'rogue', action: 'create', content: '---\nname: rogue\ndescription: x\n---\nBody' }, chat)
    expect(skillWrite.status).toBe(422)
    expect(((await skillWrite.json()) as { error: string }).error).toMatch(/Limited sessions cannot write/)
    const nestedSave = await postEngine('/engine/history/save', { chatId: chat, messages: [{ role: 'user', text: 'hi' }] })
    expect(await nestedSave.json()).toEqual({ saved: false, skipped: true })
  }

  // Unreadable lineage fails closed on /engine/skills/write and /engine/history/save.
  roots.set('unreadable-chat', null)
  expect(restarted.hiddenChat(bot.id, 'unreadable-chat')).toBe(true)
  expect((await postEngine('/engine/skills/write', { name: 'rogue', action: 'create', content: '---\nname: rogue\ndescription: x\n---\nBody' }, 'unreadable-chat')).status).toBe(
    422
  )
  expect((await postEngine('/engine/history/save', { chatId: 'unreadable-chat', messages: [{ role: 'user', text: 'hi' }] })).status).toBe(422)
})
