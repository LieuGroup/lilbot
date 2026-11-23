/** Proves no state can lock the owner out of sending in a bot's main conversation, including multi-client,
 *  compression, missing main pointer, transient lineage errors, restarts, and new sessions. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppServices } from '../../server/app-services'
import { webhookCallers } from '../../server/webhooks/webhook-callers'
import { fakeService } from '../helpers/fake-engine'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function bootApp(dir: string, fake: ReturnType<typeof fakeService>) {
  const origSetInterval = globalThis.setInterval
  ;(globalThis as { setInterval: typeof setInterval }).setInterval = (() => 0) as unknown as typeof setInterval
  const services = createAppServices(fake.engine, {
    DATA_DIR: join(dir, 'data'),
    WORKSPACES_DIR: join(dir, 'ws'),
    PORT: 3993,
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
  })
  return services
}

async function setupWebhookBot() {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-main-open-'))
  const prevSkills = process.env.LILBOT_SKILLS_DIR
  process.env.LILBOT_SKILLS_DIR = join(dir, 'skills')
  mkdirSync(join(dir, 'skills'), { recursive: true })
  const fake = fakeService()
  const roots = new Map<string, string | null>()
  const compressTo = new Map<string, string>()
  const baseOpen = fake.engine.openChat
  fake.engine.openChat = async (botId, chatId, opts, onEvent) => {
    const target = chatId && compressTo.has(chatId) ? compressTo.get(chatId)! : chatId
    if (target && compressTo.size) fake.stored.add(target)
    return baseOpen(botId, target, opts, onEvent)
  }
  fake.engine.compressionRoot = (_eb, chat) => (roots.has(chat) ? roots.get(chat)! : chat)
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(fake.root, { recursive: true, force: true })
    if (prevSkills === undefined) delete process.env.LILBOT_SKILLS_DIR
    else process.env.LILBOT_SKILLS_DIR = prevSkills
  })
  const services = bootApp(dir, fake)
  const b1 = await services.bots.createBot({ name: 'Main Bot', function: 'Main', instructions: '' })
  const hook = services.webhooks.store.create(b1.id, { requestId: 'h1', description: 'H', source: 'GH', createdBy: 'oscar' }, null, 1)
  services.threads.store.db.query("INSERT INTO webhook_runs (id, webhook_id, bot_id, created_at, status) VALUES ('r1', ?, ?, 1, 'running')").run(hook.id, b1.id)
  services.webhooks.store.attach('r1', 'wh-1', 2)
  services.webhooks.store.finish('r1', 'completed', 'ok', 3)
  fake.stored.add('wh-1')
  fake.stored.add('wh-1-child')
  return { dir, fake, services, b1, roots, compressTo }
}

test('two open clients: moving main pointer via new session or compression never blocks either client', async () => {
  const f = await setupWebhookBot()
  const c1 = await f.services.bots.openChat(f.b1.id, undefined, () => {})
  const firstId = c1.snapshot.chatId
  const c2 = await f.services.bots.newChat(f.b1.id, () => {})
  const secondId = c2.snapshot.chatId
  expect(secondId).not.toBe(firstId)

  f.roots.set(firstId, null)
  f.roots.set(secondId, null)
  await c1.send('from client 1')
  await c2.send('from client 2')
  expect(f.fake.log).toContain(`send:${firstId}:from client 1`)
  expect(f.fake.log).toContain(`send:${secondId}:from client 2`)
  c1.close()
  c2.close()
})

test('explicit open of main chat after compression advances main pointer and stays writable when lineage is unreadable', async () => {
  const f = await setupWebhookBot()
  const first = await f.services.bots.openChat(f.b1.id, undefined, () => {})
  const m1 = first.snapshot.chatId
  first.close()

  f.compressTo.set(m1, 'm2-compressed')
  f.roots.set('m2-compressed', null)
  const reopened = await f.services.bots.openChat(f.b1.id, m1, () => {})
  expect(reopened.snapshot.chatId).toBe('m2-compressed')
  // Pointer updated to the compressed successor so a subsequent default open resumes it directly.
  const mainRow = f.services.threads.store.db.query('SELECT main_chat_id FROM bot_prefs WHERE bot_id=?').get(f.b1.id) as { main_chat_id: string | null }
  expect(mainRow.main_chat_id).toBe('m2-compressed')

  await reopened.send('after compression')
  expect(f.fake.log).toContain('send:m2-compressed:after compression')
  reopened.close()
})

test('missing main_chat_id with explicit open stays writable under unreadable lineage while webhook runs stay refused', async () => {
  const f = await setupWebhookBot()
  f.fake.stored.add('m-existing')
  f.services.threads.store.db.query('UPDATE bot_prefs SET main_chat_id=NULL WHERE bot_id=?').run(f.b1.id)
  f.roots.set('m-existing', null)

  const mainExplicit = await f.services.bots.openChat(f.b1.id, 'm-existing', () => {})
  await mainExplicit.send('explicit with null main')
  expect(f.fake.log).toContain('send:m-existing:explicit with null main')
  mainExplicit.close()

  // Opening a known webhook run with NULL main pointer must still be refused and must not hijack main_chat_id.
  const wh = await f.services.bots.openChat(f.b1.id, 'wh-1', () => {}, true)
  await expect(wh.send('nope')).rejects.toMatchObject({ code: 'chat_read_only' })
  wh.close()
  const mainRow = f.services.threads.store.db.query('SELECT main_chat_id FROM bot_prefs WHERE bot_id=?').get(f.b1.id) as { main_chat_id: string | null } | null
  expect(mainRow?.main_chat_id ?? null).toBeNull()
})

test('transient lineage failure (null or thrown) never blocks main chat and recovers cleanly for compressed limited runs', async () => {
  const f = await setupWebhookBot()
  const main = await f.services.bots.openChat(f.b1.id, undefined, () => {})
  f.roots.set(main.snapshot.chatId, null)
  await main.send('during busy lookup')
  expect(f.fake.log).toContain(`send:${main.snapshot.chatId}:during busy lookup`)

  // Transient failure on a compressed webhook child fails open for chat.send (while hiddenChat stays fail-closed),
  // then refuses once lineage recovers.
  f.roots.set('wh-1-child', null)
  expect(f.services.hiddenChat(f.b1.id, 'wh-1-child')).toBe(true)
  const child = await f.services.bots.openChat(f.b1.id, 'wh-1-child', () => {}, true)
  await child.send('while lineage busy')
  f.roots.set('wh-1-child', 'wh-1')
  await expect(child.send('after lineage recovers')).rejects.toMatchObject({ code: 'chat_read_only' })
  child.close()
  main.close()

  // Direct isKnownLimited fails open even if rootOf throws, while direct limited ids still return true.
  const throwingCallers = webhookCallers(
    f.services.webhooks.store,
    () => {
      throw new Error('SQLITE_BUSY')
    },
    { gate: async () => null }
  )
  expect(throwingCallers.isKnownLimited(f.b1.id, 'wh-1')).toBe(true)
  expect(throwingCallers.isKnownLimited(f.b1.id, 'some-main-chat')).toBe(false)
})

test('after restart and after new session, main chats stay writable while webhook runs stay refused', async () => {
  const f = await setupWebhookBot()
  const initial = await f.services.bots.openChat(f.b1.id, undefined, () => {})
  const savedMain = initial.snapshot.chatId
  initial.close()

  // Restart server against the same DATA_DIR with unreadable lineage on the restarted instance.
  f.services.computers.close()
  f.services.remoteWorkers.runner.close()
  const restarted = bootApp(f.dir, f.fake)
  f.roots.set(savedMain, null)

  const resumed = await restarted.bots.openChat(f.b1.id, undefined, () => {})
  expect(resumed.snapshot.chatId).toBe(savedMain)
  await resumed.send('after restart default')
  resumed.close()

  const explicit = await restarted.bots.openChat(f.b1.id, savedMain, () => {})
  await explicit.send('after restart explicit')
  explicit.close()

  const fresh = await restarted.bots.newChat(f.b1.id, () => {})
  f.roots.set(fresh.snapshot.chatId, null)
  await fresh.send('after restart new session')
  expect(f.fake.log).toContain(`send:${savedMain}:after restart default`)
  expect(f.fake.log).toContain(`send:${savedMain}:after restart explicit`)
  expect(f.fake.log).toContain(`send:${fresh.snapshot.chatId}:after restart new session`)
  fresh.close()

  // Settled webhook run remains refused after restart.
  const wh = await restarted.bots.openChat(f.b1.id, 'wh-1', () => {}, true)
  await expect(wh.send('after restart webhook')).rejects.toMatchObject({ code: 'chat_read_only' })
  wh.close()
})
