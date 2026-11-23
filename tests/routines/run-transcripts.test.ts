import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../server/database/database'
import { RoutineService } from '../../server/routines/routine-service'
import { RoutineStore } from '../../server/routines/routine-store'
import { WEBHOOK_LIMITS } from '../../server/webhooks/webhook-limits'
import type { ChatItem } from '../../shared/chat-schema'
import { LilBotError } from '../../shared/lilbot-error'
import type { RoutineCreate } from '../../shared/routine-schema'
import { fakeService } from '../helpers/fake-engine'
import { runFixture as webhookFixture } from '../webhooks/webhook-fixture'

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
