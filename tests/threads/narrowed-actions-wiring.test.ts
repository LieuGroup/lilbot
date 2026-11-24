import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createThreads } from '../../server/app-threads'
import { Workspaces } from '../../server/bots/workspaces'
import { HistoryService } from '../../server/history/history-service'
import { HistoryStore } from '../../server/history/history-store'
import { LibraryService } from '../../server/library/library-service'
import { LibraryStore } from '../../server/library/library-store'
import { CallingChats } from '../../server/threads/calling-chats'
import { ThreadStore } from '../../server/threads/thread-store'
import { webhookCallers } from '../../server/webhooks/webhook-callers'
import { WebhookStore } from '../../server/webhooks/webhook-store'
import type { WebhookCapability } from '../../shared/webhook-schema'
import { fakeService } from '../helpers/fake-engine'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function threadFixture() {
  const fake = fakeService()
  const root = fake.root
  const threadStore = new ThreadStore(fake.database, (_b, c) => c)
  const webhookStore = new WebhookStore(fake.database)
  const calls = new CallingChats(30)
  const callers = webhookCallers(webhookStore, (_b, c) => c, calls, threadStore)
  const library = new LibraryService(
    new LibraryStore(fake.database),
    id => join(root, id),
    id => fake.store.exists(id)
  )
  const history = new HistoryService(
    new HistoryStore(fake.database),
    fake.engine,
    async () => [],
    () => true
  )
  const runs: Array<{ botId: string; prompt: string; access?: unknown; capabilities?: WebhookCapability[]; chatId?: string }> = []
  fake.service.runRoutine = async (botId, prompt, opts) => {
    const id = opts.chatId ?? `hidden:${botId}:${runs.length + 1}`
    opts.onChat?.(id)
    runs.push({ botId, prompt, access: opts.access, capabilities: (opts as { capabilities?: WebhookCapability[] }).capabilities, chatId: id })
    return { status: 'completed', text: 'ok' }
  }
  const { threads, delegation } = createThreads({
    engine: fake.engine,
    store: fake.store,
    prefs: fake.prefs,
    bots: fake.service,
    workspaces: new Workspaces(root),
    history,
    activity: fake.activity,
    threadStore,
    calls,
    work: { parentFor: () => null, child: () => {}, groupChildren: () => {}, groupEnded: () => {}, settleExchanges: () => {} } as never,
    memory: fake.memory,
    library,
    root,
    rootOf: (_b, c) => c,
    callers,
    publish: () => {},
    botsChanged: () => {},
    memoryChanged: () => {}
  })
  const saw = (botId: string, chatId: string, tool: string, args: unknown) => calls.saw(botId, chatId, tool, args, crypto.randomUUID())
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  return { ...fake, root, threadStore, webhookStore, calls, callers, library, threads, delegation, runs, saw }
}

test('createThreads gates group close/attach/status and delegation cancel/redirect/wait/status/attach on caller capabilities', async () => {
  const f = threadFixture()
  await f.service.createBot({ name: 'Bot Two', function: 'Two', instructions: '' })
  await f.service.createBot({ name: 'Bot Three', function: 'Three', instructions: '' })
  const [b1, b2, b3] = f.store.list()
  for (const b of [b1, b2, b3]) mkdirSync(join(f.root, b.id), { recursive: true })
  writeFileSync(join(f.root, b1.id, 'doc.txt'), 'secret')

  // Unrestricted exchange and unrestricted group started from main chat.
  f.saw(b1.id, 'b1-main', 'lilbot_delegate', { requestId: 'd-open', tasks: [{ to: b2.id, task: 'open task' }] })
  const openEx = (await f.delegation.hand.delegate(b1.id, { requestId: 'd-open', tasks: [{ to: b2.id, task: 'open task' }] })).exchanges[0]
  f.saw(b1.id, 'b1-main', 'lilbot_group', { action: 'start', requestId: 'g-open', purpose: 'Open', members: [b2.id, b3.id], text: 'hi', files: ['doc.txt'] })
  const openGrp = await f.delegation.groups.act(b1.id, { action: 'start', requestId: 'g-open', purpose: 'Open', members: [b2.id, b3.id], text: 'hi', files: ['doc.txt'] })

  // Narrowed ['delegation']-only webhook run on b1.
  const hook = f.webhookStore.create(b1.id, { requestId: 'h1', description: 'Hook', source: 'GH', createdBy: 'oscar' }, null, 1)
  f.webhookStore.setCapabilities(b1.id, hook.id, ['delegation'])
  f.database.query("INSERT INTO webhook_runs (id, webhook_id, bot_id, created_at, status) VALUES ('run-1', ?, ?, 1, 'running')").run(hook.id, b1.id)
  f.webhookStore.attach('run-1', 'wh-chat', 2)

  // Narrowed exchange created by wh-chat; ThreadRunner forwards capabilities to runRoutine.
  f.saw(b1.id, 'wh-chat', 'lilbot_delegate', { requestId: 'd-narrow', tasks: [{ to: b2.id, task: 'narrow task' }] })
  const narrowEx = (await f.delegation.hand.delegate(b1.id, { requestId: 'd-narrow', tasks: [{ to: b2.id, task: 'narrow task' }] })).exchanges[0]

  // Narrowed run cannot close (even with keep), status, or attach to unrestricted group.
  const closeArgs = { action: 'close' as const, groupId: openGrp.groupId, text: 'injected', keep: ['doc.txt'] }
  f.saw(b1.id, 'wh-chat', 'lilbot_group', closeArgs)
  await expect(f.delegation.groups.act(b1.id, closeArgs)).rejects.toThrow(/broader access/)
  expect(f.threadStore.get(openGrp.groupId).group?.end).toBeNull()
  expect((await f.library.list({ botId: b1.id })).items).toHaveLength(0)

  f.saw(b1.id, 'wh-chat', 'lilbot_group', { action: 'status', groupId: openGrp.groupId })
  await expect(f.delegation.groups.act(b1.id, { action: 'status', groupId: openGrp.groupId })).rejects.toThrow(/broader access/)

  // Narrowed run cannot cancel, redirect, wait, status(explicit), or attach to unrestricted exchange; bare status filters it out.
  f.saw(b1.id, 'wh-chat', 'lilbot_delegation', { action: 'cancel', exchangeId: openEx.exchangeId })
  await expect(f.delegation.control.cancel(b1.id, openEx.exchangeId)).rejects.toThrow(/broader access/)
  f.saw(b1.id, 'wh-chat', 'lilbot_delegation', { action: 'redirect', requestId: 'rd1', exchangeId: openEx.exchangeId, message: 'pwn' })
  await expect(f.delegation.control.redirect(b1.id, { requestId: 'rd1', exchangeId: openEx.exchangeId, message: 'pwn' })).rejects.toThrow(/broader access/)
  f.saw(b1.id, 'wh-chat', 'lilbot_delegation', { action: 'wait', exchangeIds: [openEx.exchangeId] })
  await expect(f.delegation.control.wait(b1.id, { exchangeIds: [openEx.exchangeId] })).rejects.toThrow(/broader access/)
  f.saw(b1.id, 'wh-chat', 'lilbot_delegation', { action: 'status', exchangeIds: [openEx.exchangeId] })
  await expect(f.delegation.control.status(b1.id, { exchangeIds: [openEx.exchangeId] })).rejects.toThrow(/broader access/)
  f.saw(b1.id, 'wh-chat', 'lilbot_delegation', { action: 'status' })
  expect((await f.delegation.control.status(b1.id, {})).exchanges.map(e => e.exchangeId)).toEqual([narrowEx.exchangeId])
  await expect(f.delegation.control.cancel(b1.id, narrowEx.exchangeId)).rejects.toThrow(/could not tell/)
  f.saw(b1.id, 'wh-chat', 'lilbot_delegation', { action: 'attach', exchangeId: openEx.exchangeId, files: ['doc.txt'] })
  await expect(f.delegation.hand.attach(b1.id, { exchangeId: openEx.exchangeId, files: ['doc.txt'] })).rejects.toThrow(/broader access/)

  // Concurrent main chat can still close its own unrestricted group (with keep) and cancel its own unrestricted exchange.
  f.saw(b1.id, 'b1-main', 'lilbot_group', closeArgs)
  await f.delegation.groups.act(b1.id, closeArgs)
  expect(f.threadStore.get(openGrp.groupId).group?.end?.how).toBe('closed')
  expect((await f.library.list({ botId: b1.id })).items).toHaveLength(1)
  f.saw(b1.id, 'b1-main', 'lilbot_delegation', { action: 'cancel', exchangeId: openEx.exchangeId })
  expect((await f.delegation.control.cancel(b1.id, openEx.exchangeId)).status).toBe('cancelled')

  // ThreadService.ask carries caller capabilities; acceptDelivery enforces strict capability-subset check.
  const asked = await f.threads.ask(b1.id, { requestId: 'ask-1', to: b2.id, text: 'hi', chatId: 'wh-chat' })
  expect(f.threadStore.get(asked.threadId).capabilities).toEqual(['delegation'])
  const broad = f.threadStore.accept(b1, b2, { requestId: 'br-1', text: 'x', chatId: 'wh-broad', capabilities: ['delegation', 'shell'] })
  expect(() => f.threadStore.accept(b1, b2, { requestId: 'br-2', text: 'y', chatId: 'wh-chat', threadId: broad.threadId, capabilities: ['delegation'] })).toThrow(/broader access/)
  f.threads.tick()
  await Bun.sleep(20)
  const narrowRun = f.runs.find(r => r.capabilities?.join(',') === 'delegation')
  expect(narrowRun?.access).toEqual({ kind: 'narrowed', capabilities: ['delegation'] })
  expect(narrowRun?.prompt).toContain('You cannot')
  expect(f.threadStore.allowsWorkerMemory('missing-thread')).toBe(false)
  expect(f.threadStore.isNarrowed('missing-thread')).toBe(true)
  // While a narrowed delivery is live on b2, webhookCallers.forCall detects mixed restricted/unrestricted starts (using forChat, not runOf) and refuses as ambiguous.
  f.threadStore.accept(b1, b2, { requestId: 'live-b2', text: 'live', chatId: 'wh-chat', threadId: narrowEx.exchangeId, capabilities: ['delegation'] })
  const b2NarrowChat = narrowRun?.chatId ?? ''
  expect(b2NarrowChat).not.toBe('')
  f.saw(b2.id, 'b2-main', 'lilbot_status', {})
  f.saw(b2.id, b2NarrowChat, 'lilbot_status', {})
  expect(await f.callers.forCall(b2.id, 'lilbot_status', {})).toEqual([])
})
