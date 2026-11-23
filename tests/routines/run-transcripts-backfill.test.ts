import { expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { RoutineScheduler } from '../../server/routines/routine-scheduler'
import { RoutineService } from '../../server/routines/routine-service'
import { RoutineStore } from '../../server/routines/routine-store'
import { isTranscriptGone } from '../../server/routines/run-transcripts'
import type { ChatItem } from '../../shared/chat-schema'
import { LilBotError } from '../../shared/lilbot-error'
import type { RoutineCreate } from '../../shared/routine-schema'
import { fakeService } from '../helpers/fake-engine'
import { runFixture as webhookFixture } from '../webhooks/webhook-fixture'

const flush = () => new Promise(resolve => setTimeout(resolve, 25))
const routineInput: RoutineCreate = { requestId: 't1', description: 'Check status', schedule: { kind: 'interval', seconds: 300 }, createdBy: 'oscar' }
const rawItems: ChatItem[] = [
  { kind: 'tool', toolId: 'call-1', name: 'terminal', detail: 'date', running: false, failed: false, result: '{"ok":true}' },
  { kind: 'assistant', text: 'All clear.' }
]
const savedItems: ChatItem[] = [
  { kind: 'tool', toolId: 'call-1', name: 'terminal', detail: 'date', running: false },
  { kind: 'assistant', text: 'All clear.' }
]

const chatWith = (chatId: string, items: ChatItem[], resumeRefused?: string) => ({
  ...(resumeRefused ? { resumeRefused } : {}),
  snapshot: { chatId, botId: 'b1', title: '', running: false, workspace: '/w', items },
  send: async () => {},
  stop: async () => {},
  close: () => {}
})

const settings = { minIntervalSeconds: 300, selfCreatedCap: 5 }
const makeRoutines = (f: ReturnType<typeof fakeService>, now: () => number) => {
  const store = new RoutineStore(f.database)
  return { store, routines: new RoutineService(store, f.service, () => {}, settings, now) }
}

test('backfill confirms gone twice, never marks missing on one stale refusal, and retries transient failures', async () => {
  const f = fakeService()
  try {
    let time = 1_000_000
    const { store, routines } = makeRoutines(f, () => time)
    const routine = await routines.create('b1', routineInput)
    const addLegacy = (id: string, chatId: string, at: number) => {
      f.database
        .query("INSERT INTO routine_runs (id, routine_id, bot_id, due_at, started_at, finished_at, chat_id, status, result) VALUES (?, ?, 'b1', ?, ?, ?, ?, 'completed', 'Old')")
        .run(id, routine.id, at - 10, at - 5, at, chatId)
      f.database.query('INSERT INTO routine_chats VALUES (?, ?)').run(chatId, id)
    }
    addLegacy('run-present', 'chat-present', 950_000)
    addLegacy('run-stale', 'chat-stale', 900_000)
    addLegacy('run-flaky-confirm', 'chat-flaky-confirm', 850_000)
    addLegacy('run-gone', 'chat-gone', 800_000)

    const seen = new Map<string, number>()
    let recovered = false
    f.engine.openChat = async (_botId, chatId) => {
      const n = (seen.get(chatId!) ?? 0) + 1
      seen.set(chatId!, n)
      if (chatId === 'chat-present') return chatWith(chatId, rawItems)
      if (chatId === 'chat-stale') {
        if (n === 1) throw new LilBotError('hermes_not_found', 'Stale spare socket')
        return chatWith(chatId, [{ kind: 'assistant', text: 'Survived stale socket.' }])
      }
      if (chatId === 'chat-flaky-confirm') {
        if (!recovered && n === 1) throw new LilBotError('hermes_not_found', 'First refusal')
        if (!recovered) throw new LilBotError('engine_unavailable', 'Gateway restarted on confirm')
        return chatWith(chatId, [{ kind: 'assistant', text: 'Recovered later.' }])
      }
      throw new LilBotError('hermes_not_found', 'Confirmed gone')
    }

    const scheduler = new RoutineScheduler(
      routines,
      () => {},
      () => time
    )
    scheduler.tick()
    await flush()
    expect(store.transcripts.get('run-present')).toEqual({ status: 'saved', items: savedItems })

    scheduler.tick()
    await flush()
    expect(store.transcripts.get('run-stale')).toEqual({ status: 'saved', items: [{ kind: 'assistant', text: 'Survived stale socket.' }] })

    scheduler.tick()
    await flush()
    // First refusal + transient confirmation failure must NOT mark missing!
    expect(store.transcripts.get('run-flaky-confirm')).toBeNull()

    time += 35_000
    scheduler.tick()
    await flush()
    // Still unrecovered, try run-gone after flaky-confirm backs off
    recovered = true
    time += 35_000
    scheduler.tick()
    await flush()
    expect(store.transcripts.get('run-flaky-confirm')).toEqual({ status: 'saved', items: [{ kind: 'assistant', text: 'Recovered later.' }] })

    scheduler.tick()
    await flush()
    expect(store.transcripts.get('run-gone')).toEqual({ status: 'missing' })
    expect(seen.get('chat-gone')).toBe(2)

    const totalBefore = [...seen.values()].reduce((a, b) => a + b, 0)
    scheduler.tick()
    scheduler.tick()
    await flush()
    expect([...seen.values()].reduce((a, b) => a + b, 0)).toBe(totalBefore)
  } finally {
    f.database.close()
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('backfill makes fair progress: 21 failing runs on Bot A never starve an older healthy run on Bot B or behind them', async () => {
  const f = fakeService()
  try {
    const time = 1_000_000
    const botB = await f.service.createBot({ name: 'Bot B', function: 'Healthy', instructions: '' })
    const { store, routines } = makeRoutines(f, () => time)
    const rA = await routines.create('b1', { ...routineInput, requestId: 'ra' })
    const rB = await routines.create(botB.id, { ...routineInput, requestId: 'rb' })
    const addLegacy = (id: string, routineId: string, botId: string, chatId: string, at: number) => {
      f.database
        .query("INSERT INTO routine_runs (id, routine_id, bot_id, due_at, started_at, finished_at, chat_id, status, result) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', 'Old')")
        .run(id, routineId, botId, at - 10, at - 5, at, chatId)
    }
    for (let i = 0; i < 21; i++) addLegacy(`a-${i}`, rA.id, 'b1', `chat-a-${i}`, 900_000 - i * 100)
    addLegacy('b-healthy', rB.id, botB.id, 'chat-b-healthy', 500_000)
    for (let i = 0; i < 22; i++) addLegacy(`b-flaky-${i}`, rB.id, botB.id, `chat-bf-${i}`, 490_000 - i * 100)
    addLegacy('b-older-healthy', rB.id, botB.id, 'chat-b-older', 100_000)

    f.engine.openChat = async (engineBotId, chatId) => {
      if (engineBotId === 'native-b1') throw new LilBotError('bot_not_found', 'Bot A profile missing')
      if (chatId?.startsWith('chat-bf-')) throw new LilBotError('engine_timeout', 'Single run slow')
      return chatWith(chatId!, [{ kind: 'assistant', text: `Saved ${chatId}` }])
    }

    // Tick 1 tries Bot A -> bot_not_found backs off Bot A; Tick 2 immediately reaches Bot B's healthy run!
    routines.backfillTick()
    await flush()
    routines.backfillTick()
    await flush()
    expect(store.transcripts.get('b-healthy')).toEqual({ status: 'saved', items: [{ kind: 'assistant', text: 'Saved chat-b-healthy' }] })

    // 22 per-run timeouts on Bot B still page past backed-off runs and reach older healthy run #23 without starving!
    for (let i = 0; i < 23; i++) {
      routines.backfillTick()
      await flush()
    }
    expect(store.transcripts.get('b-older-healthy')).toEqual({ status: 'saved', items: [{ kind: 'assistant', text: 'Saved chat-b-older' }] })
  } finally {
    f.database.close()
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('interactive openRun confirms resumeRefused twice before marking not kept, then serves from SQLite', async () => {
  const f = await webhookFixture()
  try {
    f.database
      .query(
        "INSERT INTO webhook_runs (id, webhook_id, bot_id, created_at, events, started_at, finished_at, chat_id, status, result) VALUES ('legacy-wh', ?, 'b1', 10, 1, 11, 12, 'old-wh-chat', 'completed', 'Summary')"
      )
      .run(f.hook.id)
    let opens = 0
    f.engine.openChat = async () => {
      opens++
      return chatWith('fresh-chat', [], 'hermes_not_found')
    }
    const first = await f.webhooks.openRun('b1', 'legacy-wh', () => {})
    expect(opens).toBe(2)
    expect(first.snapshot.transcriptNotKept).toBe(true)
    expect(first.snapshot.items).toEqual([])
    const second = await f.webhooks.openRun('b1', 'legacy-wh', () => {})
    expect(opens).toBe(2)
    expect(second.snapshot.transcriptNotKept).toBe(true)
  } finally {
    f.clean()
  }
})

test('isTranscriptGone classifies permanent session-gone codes without treating transient outages as missing', () => {
  expect(isTranscriptGone(new LilBotError('chat_not_found', 'gone'))).toBe(true)
  expect(isTranscriptGone(new LilBotError('hermes_not_found', 'gone'))).toBe(true)
  expect(isTranscriptGone(new LilBotError('hermes_profile_mismatch', 'mismatch'))).toBe(true)
  expect(isTranscriptGone(new LilBotError('bot_not_found', 'bot missing'))).toBe(false)
  expect(isTranscriptGone(new LilBotError('engine_unavailable', 'down'))).toBe(false)
  expect(isTranscriptGone(new LilBotError('engine_timeout', 'slow'))).toBe(false)
  expect(isTranscriptGone(new Error('network'))).toBe(false)
})
