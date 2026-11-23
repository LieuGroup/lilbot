import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../server/database/database'
import { RoutineScheduler } from '../../server/routines/routine-scheduler'
import { RoutineService } from '../../server/routines/routine-service'
import { RoutineStore } from '../../server/routines/routine-store'
import { isTranscriptGone } from '../../server/routines/run-transcripts'
import { WEBHOOK_LIMITS } from '../../server/webhooks/webhook-limits'
import type { ChatItem } from '../../shared/chat-schema'
import { LilBotError } from '../../shared/lilbot-error'
import type { RoutineCreate } from '../../shared/routine-schema'
import { fakeService } from '../helpers/fake-engine'
import { runFixture as webhookFixture } from '../webhooks/webhook-fixture'

const flush = () => new Promise(resolve => setTimeout(resolve, 25))
const routineInput: RoutineCreate = { requestId: 't1', description: 'Check status', schedule: { kind: 'interval', seconds: 300 }, createdBy: 'oscar' }
const sampleItems: ChatItem[] = [
  { kind: 'user', text: 'Scheduled routine...' },
  { kind: 'tool', toolId: 'call-1', name: 'terminal', detail: 'date', running: false, failed: false, result: '{"ok":true}' },
  { kind: 'assistant', text: 'All clear.' }
]

test('finished routine runs save their transcript and open from SQLite without touching the engine', async () => {
  const f = fakeService()
  try {
    let time = 0
    const store = new RoutineStore(f.database)
    const routines = new RoutineService(
      store,
      f.service,
      () => {},
      { minIntervalSeconds: 300, selfCreatedCap: 5 },
      () => time
    )
    await routines.create('b1', routineInput)
    f.engine.runRoutine = async (_id, _prompt, options) => {
      options.onChat('engine-routine-chat')
      return { status: 'completed', text: 'All clear.', items: sampleItems }
    }
    time = 300_000
    const [run] = store.claimDue(time)
    await routines.run(run)

    // Even if the engine is completely gone/swapped, opening the finished run succeeds from SQLite.
    let engineOpens = 0
    f.engine.openChat = async () => {
      engineOpens++
      throw new LilBotError('engine_unavailable', 'Engine removed')
    }
    const opened = await routines.openRun('b1', run.id, () => {})
    expect(engineOpens).toBe(0)
    expect(opened.snapshot.chatId).toBe('engine-routine-chat')
    expect(opened.snapshot.running).toBe(false)
    expect(opened.snapshot.transcriptNotKept).toBeUndefined()
    expect(opened.snapshot.items).toEqual(sampleItems)
    await expect(opened.send('follow up')).rejects.toThrow('read-only')
    opened.close()
  } finally {
    f.database.close()
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('finished webhook runs save their transcript and open from SQLite without touching the engine', async () => {
  const f = await webhookFixture()
  try {
    f.engine.runRoutine = async (_id, _prompt, options) => {
      options.onChat('engine-hook-chat')
      return { status: 'completed', text: 'Handled.', items: sampleItems }
    }
    f.send('{"action":"labeled"}')
    await f.tick(f.now() + WEBHOOK_LIMITS.quietMs)
    const [run] = (await f.webhooks.list('b1'))[0].runs
    expect(run.status).toBe('completed')

    let engineOpens = 0
    f.engine.openChat = async () => {
      engineOpens++
      throw new LilBotError('engine_unavailable', 'Engine removed')
    }
    const opened = await f.webhooks.openRun('b1', run.id, () => {})
    expect(engineOpens).toBe(0)
    expect(opened.snapshot.chatId).toBe('engine-hook-chat')
    expect(opened.snapshot.running).toBe(false)
    expect(opened.snapshot.transcriptNotKept).toBeUndefined()
    expect(opened.snapshot.items).toEqual(sampleItems)
    opened.close()
  } finally {
    f.clean()
  }
})

test('live running runs still open from the engine', async () => {
  const f = fakeService()
  try {
    const store = new RoutineStore(f.database)
    const routines = new RoutineService(
      store,
      f.service,
      () => {},
      { minIntervalSeconds: 300, selfCreatedCap: 5 },
      () => 0
    )
    await routines.create('b1', routineInput)
    const [run] = store.claimDue(300_000)
    f.stored.add('live-chat')
    store.attach(run.id, 'live-chat', 300_000)
    const opened = await routines.openRun('b1', run.id, () => {})
    expect(opened.snapshot.chatId).toBe('live-chat')
    expect(f.log.some(line => line.startsWith('open:live-chat:'))).toBe(true)
    opened.close()
  } finally {
    f.database.close()
    rmSync(f.root, { recursive: true, force: true })
  }
})

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
    // Simulate three pre-migration finished runs (no row in routine_run_transcripts).
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
    // Tick 1: backfills newest (run-present).
    scheduler.tick()
    await flush()
    expect(store.transcripts.get('run-present')).toEqual({ status: 'saved', items: sampleItems })
    // Tick 2: run-gone is permanently missing -> marked 'missing'.
    scheduler.tick()
    await flush()
    expect(store.transcripts.get('run-gone')).toEqual({ status: 'missing' })
    // Tick 3: run-flaky fails transiently -> stays unmarked (NULL), backed off for 30s.
    scheduler.tick()
    await flush()
    expect(store.transcripts.get('run-flaky')).toBeNull()
    // Engine returns after backoff -> simulating a restart with a fresh service instance recovers cleanly.
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
    // Further ticks do nothing (no extra engine opens).
    const before = calls.length
    restarted.backfillTick()
    restarted.backfillTick()
    await flush()
    expect(calls.length).toBe(before)

    // Opening the missing run succeeds cleanly with transcriptNotKept: true instead of failing.
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
    // Second open reads 'missing' directly from SQLite with zero engine calls.
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

test('migration 40 upgrades from schema 39 without disturbing existing runs and cascades on bot deletion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-run-tx-mig-'))
  const path = join(dir, 'lilbot.db')
  try {
    let db = openDatabase(path)
    db.exec('DROP TABLE routine_run_transcripts; DROP TABLE webhook_run_transcripts; PRAGMA user_version = 39;')
    db.close()
    db = openDatabase(path)
    expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: 40 })
    db.query("INSERT INTO bots (id, name, function, instructions, engine_id, engine_bot_id) VALUES ('b1', 'One', '', '', 'test', 'native-b1')").run()
    db.query("INSERT INTO routines (id, bot_id, request_id, description, schedule, created_by, next_run_at) VALUES ('r1', 'b1', 'req', 'Task', '{}', 'oscar', 1)").run()
    db.query("INSERT INTO routine_runs (id, routine_id, bot_id, due_at, status) VALUES ('run-1', 'r1', 'b1', 1, 'completed')").run()
    const store = new RoutineStore(db)
    store.transcripts.save('run-1', sampleItems, 100)
    expect(store.transcripts.get('run-1')).toEqual({ status: 'saved', items: sampleItems })
    store.forgetBot('b1')
    expect(db.query('SELECT COUNT(*) AS n FROM routine_run_transcripts').get()).toEqual({ n: 0 })
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
