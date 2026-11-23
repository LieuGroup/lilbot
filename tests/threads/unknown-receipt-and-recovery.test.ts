/** Tests for Item 2 (unknownReceipt stop confirmation for webhook runs, limited hand-offs, and Hermes) and Item 3 (unsettled-row recovery). */
import { afterAll, expect, test } from 'bun:test'
import { confirmStopped } from '../../server/background'
import { openDatabase } from '../../server/database/database'
import { CallingChats } from '../../server/threads/calling-chats'
import { ThreadFiles } from '../../server/threads/thread-files'
import { ThreadRunner } from '../../server/threads/thread-runner'
import type { ThreadStore } from '../../server/threads/thread-store'
import { ThreadWaits } from '../../server/threads/thread-waits'
import { webhookCallers } from '../../server/webhooks/webhook-callers'
import { WebhookService } from '../../server/webhooks/webhook-service'
import { WebhookStore } from '../../server/webhooks/webhook-store'
import { LilBotError } from '../../shared/lilbot-error'
import { delegationFixture, removeFixtureFolders } from './delegation-fixture'

afterAll(removeFixtureFolders)

const VIEW = { item: '{"ok":true}', size: 11, refusal: null }

function hookDb(reqId: string) {
  const db = openDatabase(':memory:')
  db.query("INSERT INTO bots(id, name, function, instructions, engine_id, engine_bot_id) VALUES ('b1', 'B1', '', '', 'test', 'n1')").run()
  const store = new WebhookStore(db)
  const hook = store.create('b1', { requestId: reqId, description: 'H', source: 'GH', createdBy: 'oscar' }, null, 1)
  store.events.add(hook.id, { deliveryId: 'd1', bodyHash: null }, VIEW, 10)
  const [run] = store.claimDue(20_000)
  return { db, store, hook, run }
}

test('confirmStopped returns immediately on false/gone, polls until stopped, and throws run_still_active on bound expiry', async () => {
  let sleeps = 0
  let now = 1000
  const sleep = async (ms: number) => {
    sleeps++
    now += ms
  }
  const opts = { timeoutMs: 50, pollMs: 20, now: () => now, sleep }
  const failWith = (code: string) => async () => {
    throw new LilBotError(code, code)
  }
  await confirmStopped(async () => false, opts)
  await confirmStopped(failWith('session_not_found'), opts)
  await confirmStopped(failWith('bot_not_found'), opts)
  expect(sleeps).toBe(0)

  let calls = 0
  await confirmStopped(async () => ++calls < 3, opts)
  expect([calls, sleeps]).toEqual([3, 2])

  now = 1000
  await expect(confirmStopped(async () => true, { timeoutMs: 40, pollMs: 20, now: () => now, sleep })).rejects.toMatchObject({ code: 'run_still_active' })
  await expect(confirmStopped(failWith('engine_unavailable'), opts)).rejects.toMatchObject({ code: 'engine_unavailable' })
})

test('webhook run unknownReceipt keeps gating armed in stopping state without re-calling runRoutine until engine confirms stopped', async () => {
  const { db, store, run } = hookDb('h-unk')
  let runCalls = 0
  let running = true
  let stopCalls = 0
  const host = {
    requireBot: async () => ({}),
    openChat: async () => ({}) as any,
    runRoutine: async (_b: string, _p: string, opts: any) => {
      runCalls++
      opts.onChat('wh-unk-chat')
      return { status: 'failed' as const, text: 'Routine ended: unknown. Execution was not retried.', unknownReceipt: true as const }
    },
    stopRun: async () => {
      stopCalls++
      return running
    }
  }
  const svc = new WebhookService(store, host, 'key', 'https://h.example', undefined, () => 25_000, false, { timeoutMs: 30, pollMs: 10 })
  await expect(svc.run(run)).rejects.toMatchObject({ code: 'run_still_active' })
  expect(runCalls).toBe(1)
  expect(stopCalls).toBeGreaterThanOrEqual(2)
  expect(store.isStopping(run.id)).toBe(true)
  expect(store.run('b1', run.id).status).toBe('running')
  expect(store.activeRunCaps('b1')).toEqual([[]])
  expect(store.pending().map(r => r.id)).toEqual([run.id])

  // Retry/restart calls only stopRun (never runRoutine), then settles and disarms gating once stopped.
  running = false
  expect((await svc.run(store.pending()[0])).status).toBe('failed')
  expect(runCalls).toBe(1)
  expect(store.isStopping(run.id)).toBe(false)
  expect(store.run('b1', run.id).status).toBe('failed')
  expect(store.activeRunCaps('b1')).toEqual([])
  expect(store.pending()).toEqual([])
  db.close()
})

test('deleted webhook with running run recovers across restart via confirmStopped without events or runRoutine and disarms gating', async () => {
  const { db, store, hook, run } = hookDb('h-del')
  store.attach(run.id, 'wh-del-chat', 21_000)
  store.delete('b1', hook.id)
  expect(store.events.forRun(run.id).items).toEqual([])
  expect(store.activeRunCaps('b1')).toEqual([[]])
  expect(store.pending().map(r => r.id)).toEqual([run.id])

  let runCalls = 0
  let stopCalls = 0
  const svc = new WebhookService(
    store,
    {
      requireBot: async () => ({}),
      openChat: async () => ({}) as any,
      runRoutine: async () => {
        runCalls++
        return { status: 'completed', text: 'nope' }
      },
      stopRun: async () => ++stopCalls === 1
    },
    'key',
    'https://h.example',
    undefined,
    () => 30_000,
    false,
    { timeoutMs: 80, pollMs: 10 }
  )
  expect((await svc.run(store.pending()[0])).status).toBe('stopped')
  expect(runCalls).toBe(0)
  expect(stopCalls).toBe(2)
  expect(store.run('b1', run.id).status).toBe('stopped')
  expect(store.activeRunCaps('b1')).toEqual([])
  expect(store.pending()).toEqual([])
  db.close()
})

test('limited hand-off unknownReceipt keeps gating armed until stopped, and orphaned steered deliveries reconcile', async () => {
  const f = delegationFixture()
  const store = f.store as ThreadStore
  const callers = webhookCallers(new WebhookStore(store.db), (_b, c) => c, new CallingChats(50), store)
  const d = store.accept({ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { requestId: 'unk-work', text: 'task', chatId: 'a-wh', capabilities: ['delegation'] })
  let runCalls = 0
  let stillRunning = true
  const makeRunner = () =>
    new ThreadRunner(
      store,
      new ThreadFiles(store.db),
      new ThreadWaits(store),
      {
        requireBot: async id => ({ id, name: id.toUpperCase() }),
        runRoutine: async (_botId, _prompt, opts) => {
          runCalls++
          opts.onChat('b-narrow-unk')
          return { status: 'failed', text: 'Routine ended: unknown. Execution was not retried.', unknownReceipt: true }
        },
        stopRun: async () => stillRunning
      },
      () => {},
      () => {},
      () => {},
      undefined,
      { timeoutMs: 30, pollMs: 10 }
    )
  makeRunner().tick()
  await Bun.sleep(60)
  expect(runCalls).toBe(1)
  expect(store.delivery(d.id)?.status).toBe('stopping')
  expect(callers.unplacedCapabilities('b')).toEqual(['delegation'])

  stillRunning = false
  const r2 = makeRunner()
  r2.tick()
  await Bun.sleep(30)
  expect(runCalls).toBe(1)
  expect(store.delivery(d.id)?.status).toBe('done')
  expect(store.get(d.threadId)).toMatchObject({ status: 'failed', failure: 'LilBot could not confirm how the turn ended' })
  expect(callers.unplacedCapabilities('b')).toBeNull()

  // Orphaned 'steered' on cancelled settles 'done'; on finished returns to 'pending' and runs.
  const orphanFail = store.accept({ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { requestId: 'st-fail', text: 'r1', chatId: 'a-wh', threadId: d.threadId, kind: 'redirect' })
  store.update(d.threadId, t => Object.assign(t, { status: 'cancelled' }))
  store.setStatus(orphanFail.id, 'steered')
  expect(callers.unplacedCapabilities('b')).toEqual(['delegation'])
  r2.tick()
  expect(store.delivery(orphanFail.id)?.status).toBe('done')
  expect(callers.unplacedCapabilities('b')).toBeNull()

  const ex2 = store.accept({ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { requestId: 'ex2', text: 'ok', chatId: 'a-wh', capabilities: ['delegation'] })
  store.setStatus(ex2.id, 'done')
  store.update(ex2.threadId, t => Object.assign(t, { status: 'finished' }))
  const orphanFin = store.accept({ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { requestId: 'st-fin', text: 'follow', chatId: 'a-wh', threadId: ex2.threadId, kind: 'redirect' })
  store.setStatus(orphanFin.id, 'steered')
  r2.tick()
  await Bun.sleep(30)
  expect(store.delivery(orphanFin.id)?.status).toBe('done')
  expect(callers.unplacedCapabilities('b')).toBeNull()
})
