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

test('permanent session_not_found settles reply and notice deliveries without shedding the session’s limits; transient errors keep retrying', async () => {
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
  let mode: 'transient' | 'gone' = 'transient'
  const runner = new ThreadRunner(
    store,
    files,
    new ThreadWaits(store),
    {
      requireBot: async id => ({ id, name: id.toUpperCase() }),
      runRoutine: async () => {
        if (mode === 'transient') throw new LilBotError('engine_unavailable', 'Hermes restarting.')
        throw new LilBotError('session_not_found', 'That conversation no longer exists.')
      }
    },
    () => {},
    () => {},
    () => {}
  )

  // Transient error: neither delivery settles and gating remains armed.
  runner.tick()
  await Bun.sleep(10)
  expect(store.delivery('ans-1')?.status).toBe('pending')
  expect(store.delivery('not-1')?.status).toBe('pending')
  expect(callers.unplacedCapabilities('b')).toEqual(['delegation'])

  // Permanent session_not_found: both reply and notice settle cleanly, gating clears, exchange stays finished, and b-narrow stays permanently limited.
  mode = 'gone'
  const freshRunner = new ThreadRunner(
    store,
    files,
    new ThreadWaits(store),
    {
      requireBot: async id => ({ id, name: id.toUpperCase() }),
      runRoutine: async () => {
        throw new LilBotError('session_not_found', 'That conversation no longer exists.')
      }
    },
    () => {},
    () => {},
    () => {}
  )
  freshRunner.tick()
  await Bun.sleep(10)
  freshRunner.tick()
  await Bun.sleep(10)
  expect(store.delivery('ans-1')?.status).toBe('done')
  expect(store.delivery('not-1')?.status).toBe('done')
  expect(store.get(inner.threadId).status).toBe('finished')
  expect(callers.unplacedCapabilities('b')).toBeNull()
  expect(callers.forChat('b', 'b-narrow')).toEqual(['delegation'])

  // Non-reply work deliveries whose existing session is confirmed gone fail cleanly and disarm gating instead of retrying forever.
  const work = store.accept(
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { requestId: 'work-2', text: 'more', chatId: 'a-wh', threadId: outer.threadId, capabilities: ['delegation'] }
  )
  freshRunner.tick()
  await Bun.sleep(10)
  expect(store.delivery(work.id)?.status).toBe('done')
  expect(store.get(outer.threadId)).toMatchObject({ status: 'failed', failure: 'the conversation no longer exists' })
  expect(callers.unplacedCapabilities('b')).toBeNull()
  expect(callers.forChat('b', 'b-narrow')).toEqual(['delegation'])
})
