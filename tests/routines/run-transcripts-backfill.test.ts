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
const sampleItems: ChatItem[] = [
  { kind: 'tool', toolId: 'call-1', name: 'terminal', detail: 'date', running: false, failed: false, result: '{"ok":true}' },
  { kind: 'assistant', text: 'All clear.' }
]

test('backfill saves legacy runs once, marks missing sessions as not kept, and retries transient failures safely', async () => {
  const f = fakeService()
  try {
    let time = 1_000_000
    const store = new RoutineStore(f.database)
    const routines = new RoutineService(
      store,
      f.service,
      () => {},
      { minIntervalSeconds: 300, selfCreatedCap: 5 },
      () => time
    )
    const routine = await routines.create('b1', routineInput)
    const insertLegacy = (id: string, chatId: string, finishedAt: number) => {
      f.database
        .query(
          "INSERT INTO routine_runs (id, routine_id, bot_id, due_at, started_at, finished_at, chat_id, status, result) VALUES (?, ?, 'b1', ?, ?, ?, ?, 'completed', 'Old result')"
        )
        .run(id, routine.id, finishedAt - 10, finishedAt - 5, finishedAt, chatId)
      f.database.query('INSERT INTO routine_chats VALUES (?, ?)').run(chatId, id)
    }
    insertLegacy('run-present', 'chat-present', 900_000)
    insertLegacy('run-gone', 'chat-gone', 800_000)
    insertLegacy('run-flaky', 'chat-flaky', 700_000)

    let flakyOnline = false
    const calls: string[] = []
    f.engine.openChat = async (_botId, chatId) => {
      calls.push(chatId ?? '')
      if (chatId === 'chat-present')
        return { snapshot: { chatId, botId: 'b1', title: '', running: false, workspace: '/w', items: sampleItems }, send: async () => {}, stop: async () => {}, close: () => {} }
      if (chatId === 'chat-gone') throw new LilBotError('hermes_not_found', 'Session not found.')
      if (chatId === 'chat-flaky' && !flakyOnline) throw new LilBotError('engine_unavailable', 'Gateway restarting')
      return {
        snapshot: { chatId: chatId!, botId: 'b1', title: '', running: false, workspace: '/w', items: [{ kind: 'assistant', text: 'Recovered.' }] },
        send: async () => {},
        stop: async () => {},
        close: () => {}
      }
    }

    const scheduler = new RoutineScheduler(
      routines,
      () => {},
      () => time
    )
    scheduler.tick()
    await flush()
    expect(store.transcripts.get('run-present')).toEqual({ status: 'saved', items: sampleItems })
    scheduler.tick()
    await flush()
    expect(store.transcripts.get('run-gone')).toEqual({ status: 'missing' })
    scheduler.tick()
    await flush()
    expect(store.transcripts.get('run-flaky')).toBeNull()

    flakyOnline = true
    time += 35_000
    const restarted = new RoutineService(
      new RoutineStore(f.database),
      f.service,
      () => {},
      { minIntervalSeconds: 300, selfCreatedCap: 5 },
      () => time
    )
    restarted.backfillTick()
    await flush()
    expect(store.transcripts.get('run-flaky')).toEqual({ status: 'saved', items: [{ kind: 'assistant', text: 'Recovered.' }] })

    const before = calls.length
    restarted.backfillTick()
    restarted.backfillTick()
    await flush()
    expect(calls.length).toBe(before)

    const gone = await restarted.openRun('b1', 'run-gone', () => {})
    expect(gone.snapshot.transcriptNotKept).toBe(true)
    expect(gone.snapshot.items).toEqual([])
    expect(gone.snapshot.running).toBe(false)
    expect(calls.length).toBe(before)
  } finally {
    f.database.close()
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('interactive openRun backfills a legacy run on demand and handles resumeRefused as not kept', async () => {
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
      return {
        snapshot: { chatId: 'fresh-chat', botId: 'b1', title: '', running: false, workspace: '/w', items: [] },
        resumeRefused: 'hermes_not_found',
        send: async () => {},
        stop: async () => {},
        close: () => {}
      }
    }
    const first = await f.webhooks.openRun('b1', 'legacy-wh', () => {})
    expect(opens).toBe(1)
    expect(first.snapshot.transcriptNotKept).toBe(true)
    expect(first.snapshot.items).toEqual([])
    const second = await f.webhooks.openRun('b1', 'legacy-wh', () => {})
    expect(opens).toBe(1)
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
