import { afterAll, expect, test } from 'bun:test'
import { CallingChats } from '../../server/threads/calling-chats'
import { ThreadFiles } from '../../server/threads/thread-files'
import { ThreadRunner } from '../../server/threads/thread-runner'
import type { ThreadStore } from '../../server/threads/thread-store'
import { ThreadWaits } from '../../server/threads/thread-waits'
import { webhookCallers } from '../../server/webhooks/webhook-callers'
import { WebhookStore } from '../../server/webhooks/webhook-store'
import { LilBotError } from '../../shared/lilbot-error'
import { delegationFixture, removeFixtureFolders } from './delegation-fixture'

afterAll(removeFixtureFolders)

test('confirmed session_not_found settles reply, notice, work, and group deliveries cleanly without shedding limits; transient errors retry and unknownReceipt never interrupts ordinary chats', async () => {
  const f = delegationFixture()
  const store = f.store as ThreadStore
  const webhookStore = new WebhookStore(store.db)
  const calls = new CallingChats(50)
  const callers = webhookCallers(webhookStore, (_b, c) => c, calls, store)

  // Bot b has a settled narrowed exchange (chat b-narrow) and delegates a child exchange from it.
  const outer = store.accept({ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { requestId: 'outer', text: 'do x', chatId: 'a-wh', capabilities: ['delegation'] })
  store.attach(outer, 'b', 'b-narrow', true)
  store.setStatus(outer.id, 'done')
  expect(callers.unplacedCapabilities('b')).toBeNull()

  const inner = store.accept({ id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { requestId: 'inner', text: 'sub', chatId: 'b-narrow', capabilities: ['delegation'] })
  store.setStatus(inner.id, 'done')
  store.update(inner.threadId, t => Object.assign(t, { status: 'finished', endedAt: Date.now() }))
  store.enqueue('ans-1', inner.threadId, 'c', 'b', 'b-narrow', 'Sub answer', 'answer')
  store.enqueue('not-1', inner.threadId, 'b', 'b', 'b-narrow', 'Group ended', 'notice')
  expect(callers.unplacedCapabilities('b')).toEqual(['delegation'])

  const files = new ThreadFiles(store.db)
  const makeRunner = (err: LilBotError) =>
    new ThreadRunner(
      store,
      files,
      new ThreadWaits(store),
      {
        requireBot: async id => ({ id, name: id.toUpperCase() }),
        runRoutine: async () => {
          throw err
        }
      },
      () => {},
      () => {},
      () => {}
    )

  // Transient error keeps deliveries pending and gating armed.
  makeRunner(new LilBotError('engine_unavailable', 'Engine restarting.')).tick()
  await Bun.sleep(10)
  expect(store.delivery('ans-1')?.status).toBe('pending')
  expect(store.delivery('not-1')?.status).toBe('pending')
  expect(callers.unplacedCapabilities('b')).toEqual(['delegation'])

  // Permanent session_not_found settles reply and notice without failing the finished exchange or shedding session limits.
  const goneRunner = makeRunner(new LilBotError('session_not_found', 'That conversation no longer exists.'))
  goneRunner.tick()
  await Bun.sleep(10)
  goneRunner.tick()
  await Bun.sleep(10)
  expect(store.delivery('ans-1')?.status).toBe('done')
  expect(store.delivery('not-1')?.status).toBe('done')
  expect(store.get(inner.threadId).status).toBe('finished')
  expect(callers.unplacedCapabilities('b')).toBeNull()
  expect(callers.forChat('b', 'b-narrow')).toEqual(['delegation'])

  // Permanent session_not_found on a work delivery fails the exchange cleanly and disarms gating.
  const work = store.accept(
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { requestId: 'work-2', text: 'more', chatId: 'a-wh', threadId: outer.threadId, capabilities: ['delegation'] }
  )
  goneRunner.tick()
  await Bun.sleep(10)
  expect(store.delivery(work.id)?.status).toBe('done')
  expect(store.get(outer.threadId)).toMatchObject({ status: 'failed', failure: 'the conversation no longer exists' })
  expect(callers.unplacedCapabilities('b')).toBeNull()
  expect(callers.forChat('b', 'b-narrow')).toEqual(['delegation'])

  // Ordinary main-chat answer with unknownReceipt NEVER interrupts Oscar's main conversation.
  const mainEx = store.accept({ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { requestId: 'ord-1', text: 'hi', chatId: 'a-main' })
  store.setStatus(mainEx.id, 'done')
  store.update(mainEx.threadId, t => Object.assign(t, { status: 'finished', endedAt: Date.now() }))
  store.enqueue('ord-ans', mainEx.threadId, 'b', 'a', 'a-main', 'Answer text', 'answer')
  const stops: string[] = []
  const ordRunner = new ThreadRunner(
    store,
    files,
    new ThreadWaits(store),
    {
      requireBot: async id => ({ id, name: id.toUpperCase() }),
      runRoutine: async () => ({ status: 'failed', text: 'Routine ended: unknown.', unknownReceipt: true }),
      stopRun: async (_botId, chatId) => {
        stops.push(chatId)
        return true
      }
    },
    () => {},
    () => {},
    () => {}
  )
  ordRunner.tick()
  await Bun.sleep(15)
  expect(stops).toEqual([])
  expect(store.delivery('ord-ans')?.status).toBe('done')

  // Group point delivery hitting confirmed session_not_found records the error and settles 'done' instead of retrying forever.
  const gf = delegationFixture()
  const started = await gf.groups.act('a', { action: 'start', requestId: 'g1', purpose: 'sync', members: ['b', 'c'], text: 'go' })
  const grpId = started.groupId
  const point = gf.store.pending().find(d => d.threadId === grpId && d.target === 'b')!
  const grpRunner = new ThreadRunner(
    gf.store,
    gf.threads.files,
    gf.threads.waits,
    {
      requireBot: async id => ({ id, name: id.toUpperCase() }),
      runRoutine: async () => {
        throw new LilBotError('session_not_found', 'That conversation no longer exists.')
      }
    },
    () => {},
    () => {},
    () => {},
    (gf.threads.runner as any).groups
  )
  grpRunner.tick()
  await Bun.sleep(20)
  expect(gf.store.delivery(point.id)?.status).toBe('done')
  expect(gf.store.get(grpId).messages.some(m => m.items.some(i => i.kind === 'error' && i.text.includes('the conversation no longer exists')))).toBe(true)
})
