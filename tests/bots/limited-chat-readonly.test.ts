/** Verifies read-only send guards on limited conversations and verified-session engine API enforcement without affecting ordinary main chats. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppServices } from '../../server/app-services'
import { botCapability } from '../../server/bots/bot-capability'
import { openDatabase } from '../../server/database/database'
import { engineToken } from '../../server/http/engine-api'
import { WebhookService } from '../../server/webhooks/webhook-service'
import { WebhookStore } from '../../server/webhooks/webhook-store'
import { fakeService } from '../helpers/fake-engine'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

async function appFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-ro-chat-'))
  const prevSkills = process.env.LILBOT_SKILLS_DIR
  process.env.LILBOT_SKILLS_DIR = join(dir, 'skills')
  mkdirSync(join(dir, 'skills'), { recursive: true })
  const origSetInterval = globalThis.setInterval
  ;(globalThis as { setInterval: typeof setInterval }).setInterval = (() => 0) as unknown as typeof setInterval
  const fake = fakeService()
  const roots = new Map<string, string | null>()
  fake.engine.compressionRoot = (_eb, chat) => (roots.has(chat) ? roots.get(chat)! : chat)
  const services = createAppServices(fake.engine, {
    DATA_DIR: join(dir, 'data'),
    WORKSPACES_DIR: join(dir, 'ws'),
    PORT: 3992,
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
  const enginePost = (botId: string, path: string, body: Record<string, unknown>, session?: string) =>
    services.engineApi(
      new Request(`http://127.0.0.1:3992${path}`, {
        method: 'POST',
        headers: {
          host: '127.0.0.1:3992',
          authorization: `Bearer ${token}`,
          'x-lilbot-bot-capability': botCapability(token, botId),
          ...(session ? { 'x-lilbot-session': session } : {}),
          'content-type': 'application/json'
        },
        body: JSON.stringify(body)
      }),
      path
    )
  return { services, fake, b1, b2, roots, enginePost }
}

test('limited conversations refuse chat.send while main conversations remain writable even with unreadable lineage', async () => {
  const f = await appFixture()
  // Create a settled webhook run on b1 and a settled narrowed hand-off on zero-webhook bot b2.
  const hook = f.services.webhooks.store.create(f.b1.id, { requestId: 'h1', description: 'H', source: 'GH', createdBy: 'oscar' }, null, 1)
  f.services.threads.store.db.query("INSERT INTO webhook_runs (id, webhook_id, bot_id, created_at, status) VALUES ('r1', ?, ?, 1, 'running')").run(hook.id, f.b1.id)
  f.services.webhooks.store.attach('r1', 'wh-1', 2)
  f.services.webhooks.store.finish('r1', 'completed', 'ok', 3)
  f.fake.stored.add('wh-1')
  f.fake.stored.add('wh-1-child')
  f.roots.set('wh-1-child', 'wh-1')

  const ex = f.services.threads.store.accept(f.b1, f.b2, { requestId: 'd1', text: 'work', chatId: 'wh-1', capabilities: [] })
  f.services.threads.store.attach(ex, f.b2.id, 'b2-narrow', true)
  f.services.threads.store.setStatus(ex.id, 'done')
  f.fake.stored.add('b2-narrow')
  f.fake.stored.add('b2-narrow-child')
  f.roots.set('b2-narrow-child', 'b2-narrow')

  // Opening settled webhook run, narrowed hand-off, or their readable compressed children refuses send().
  for (const [botId, chatId] of [
    [f.b1.id, 'wh-1'],
    [f.b1.id, 'wh-1-child'],
    [f.b2.id, 'b2-narrow'],
    [f.b2.id, 'b2-narrow-child']
  ] as const) {
    const chat = await f.services.bots.openChat(botId, chatId, () => {}, true)
    await expect(chat.send('continue')).rejects.toMatchObject({ code: 'chat_read_only' })
    chat.close()
  }
  const runChat = await f.services.webhooks.openRun(f.b1.id, 'r1', () => {})
  await expect(runChat.send('continue')).rejects.toMatchObject({ code: 'chat_read_only' })
  runChat.close()

  // Direct limited ids stay refused even if lineage lookup fails; unknown/unreadable continuations fail OPEN for chat.send
  // while history hiding (`hiddenChat`) stays fail-closed.
  f.roots.set('wh-1', null)
  f.roots.set('b2-narrow', null)
  f.roots.set('wh-1-unreadable-child', null)
  f.fake.stored.add('wh-1-unreadable-child')
  for (const [botId, chatId] of [
    [f.b1.id, 'wh-1'],
    [f.b2.id, 'b2-narrow']
  ] as const) {
    const chat = await f.services.bots.openChat(botId, chatId, () => {}, true)
    await expect(chat.send('continue')).rejects.toMatchObject({ code: 'chat_read_only' })
    chat.close()
  }
  expect(f.services.hiddenChat(f.b1.id, 'wh-1-unreadable-child')).toBe(true)
  const unreadableChild = await f.services.bots.openChat(f.b1.id, 'wh-1-unreadable-child', () => {}, true)
  await unreadableChild.send('unblocked when lineage unreadable')
  expect(f.fake.log).toContain('send:wh-1-unreadable-child:unblocked when lineage unreadable')
  unreadableChild.close()

  // Oscar's main conversation on b1 (even with webhook runs AND unreadable lineage) sends normally without error.
  const mainChat = await f.services.bots.openChat(f.b1.id, undefined, () => {})
  f.roots.set(mainChat.snapshot.chatId, null)
  await mainChat.send('hello from Oscar')
  expect(f.fake.log).toContain(`send:${mainChat.snapshot.chatId}:hello from Oscar`)
  mainChat.close()
})

test('WebhookService.openRun wraps send as read-only even when host.openChat allows send', async () => {
  const db = openDatabase(':memory:')
  db.query("INSERT INTO bots(id, name, function, instructions, engine_id, engine_bot_id) VALUES ('b1', 'B1', '', '', 'test', 'n1')").run()
  const store = new WebhookStore(db)
  const hook = store.create('b1', { requestId: 'h-open', description: 'H', source: 'GH', createdBy: 'oscar' }, null, 1)
  db.query("INSERT INTO webhook_runs (id, webhook_id, bot_id, created_at, status) VALUES ('r-open', ?, 'b1', 1, 'completed')").run(hook.id)
  store.attach('r-open', 'wh-open', 2)
  store.finish('r-open', 'completed', 'ok', 3)
  let hostSent = 0
  const svc = new WebhookService(
    store,
    {
      requireBot: async () => ({}),
      runRoutine: async () => ({ status: 'completed', text: 'ok' }),
      openChat: async () => ({
        snapshot: { chatId: 'wh-open', botId: 'b1', title: 'Run', workspace: '/tmp', items: [], running: false },
        send: async () => {
          hostSent++
        },
        stop: async () => {},
        close: () => {}
      })
    },
    'key',
    'https://h.example'
  )
  const chat = await svc.openRun('b1', 'r-open', () => {})
  await expect(chat.send('continue')).rejects.toMatchObject({ code: 'chat_read_only' })
  expect(hostSent).toBe(0)
  db.close()
})

test('engine API refusal aligns with verified session for body chatId', async () => {
  const f = await appFixture()
  const ex = f.services.threads.store.accept(f.b1, f.b2, { requestId: 'd-api', text: 'task', chatId: 'wh-x', capabilities: [] })
  f.services.threads.store.attach(ex, f.b2.id, 'b2-settled-narrow', true)
  f.services.threads.store.setStatus(ex.id, 'done')

  const bot2 = await f.services.bots.getBot(f.b2.id)
  mkdirSync(bot2.workspace, { recursive: true })
  writeFileSync(join(bot2.workspace, 'note.txt'), 'hello')

  // Body chatId without header uses the verified session for refusal checks.
  expect((await f.enginePost(f.b2.id, '/engine/library/give', { path: 'note.txt', title: 'Note', chatId: 'b2-settled-narrow' })).status).toBe(422)
  expect((await f.enginePost(f.b2.id, '/engine/threads/ask', { requestId: 'a1', to: f.b1.id, text: 'hi', chatId: 'b2-settled-narrow' })).status).toBe(422)
  expect((await f.enginePost(f.b2.id, '/engine/library/give', { path: 'note.txt', title: 'Note', chatId: 'b2-settled-narrow' }, 'b2-main')).status).toBe(422)

  // Ordinary main conversation on b2 passes 200.
  expect((await f.enginePost(f.b2.id, '/engine/library/give', { path: 'note.txt', title: 'OK', chatId: 'b2-main' })).status).toBe(200)
  expect((await f.enginePost(f.b2.id, '/engine/threads/ask', { requestId: 'a2', to: f.b1.id, text: 'hi', chatId: 'b2-main' })).status).toBe(200)
})
