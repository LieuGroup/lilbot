import { expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { RoutineService } from '../../server/routines/routine-service'
import { RoutineStore } from '../../server/routines/routine-store'
import { WEBHOOK_LIMITS } from '../../server/webhooks/webhook-limits'
import type { ChatItem } from '../../shared/chat-schema'
import { LilBotError } from '../../shared/lilbot-error'
import type { RoutineCreate } from '../../shared/routine-schema'
import { fakeService } from '../helpers/fake-engine'
import { runFixture as webhookFixture } from '../webhooks/webhook-fixture'

const routineInput: RoutineCreate = { requestId: 't1', description: 'Check status', schedule: { kind: 'interval', seconds: 300 }, createdBy: 'oscar' }
const rawItems: ChatItem[] = [
  { kind: 'user', text: 'Scheduled routine wrapper or webhook JSON {"secret_event":"PRIVATE_PAYLOAD_123"}' },
  { kind: 'tool', toolId: 'call-1', name: 'terminal', detail: 'date', running: false, failed: false, result: '{"stdout":"PRIVATE_TOOL_RESULT_456"}' },
  { kind: 'assistant', text: 'All clear.', usage: { inputTokens: 10, outputTokens: 5 } }
]
const expectedStored: ChatItem[] = [
  { kind: 'tool', toolId: 'call-1', name: 'terminal', detail: 'date', running: false },
  { kind: 'assistant', text: 'All clear.', usage: { inputTokens: 10, outputTokens: 5 } }
]

const settings = { minIntervalSeconds: 300, selfCreatedCap: 5 }
const makeRoutines = (f: ReturnType<typeof fakeService>, now: () => number) => {
  const store = new RoutineStore(f.database)
  return { store, routines: new RoutineService(store, f.service, () => {}, settings, now) }
}

test('finished routine runs save sanitized transcripts and open from SQLite without touching the engine', async () => {
  const f = fakeService()
  try {
    let time = 0
    const { store, routines } = makeRoutines(f, () => time)
    await routines.create('b1', routineInput)
    f.engine.runRoutine = async (_id, _prompt, options) => {
      options.onChat('engine-routine-chat')
      return { status: 'completed', text: 'All clear.', items: rawItems }
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
    expect(opened.snapshot.items).toEqual(expectedStored)
    await expect(opened.send('follow up')).rejects.toThrow('read-only')
    opened.close()
  } finally {
    f.database.close()
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('finished webhook runs strip incoming event payloads and tool results, open from SQLite, and reject sends', async () => {
  const f = await webhookFixture()
  try {
    f.engine.runRoutine = async (_id, prompt, options) => {
      options.onChat('engine-hook-chat')
      return { status: 'completed', text: 'Handled.', items: [{ kind: 'user', text: prompt }, ...rawItems.slice(1)] }
    }
    f.send('{"action":"labeled","customer_note":"SENSITIVE_EVENT_999"}')
    await f.tick(f.now() + WEBHOOK_LIMITS.quietMs)
    const [run] = (await f.webhooks.list('b1'))[0].runs
    expect(run.status).toBe('completed')

    const rawRow = f.database.query('SELECT items FROM webhook_run_transcripts WHERE run_id = ?').get(run.id) as { items: string }
    expect(rawRow.items).not.toContain('SENSITIVE_EVENT_999')
    expect(rawRow.items).not.toContain('PRIVATE_TOOL_RESULT_456')

    let engineOpens = 0
    f.engine.openChat = async () => {
      engineOpens++
      throw new LilBotError('engine_unavailable', 'Engine removed')
    }
    const opened = await f.webhooks.openRun('b1', run.id, () => {})
    expect(engineOpens).toBe(0)
    expect(opened.snapshot.chatId).toBe('engine-hook-chat')
    expect(opened.snapshot.running).toBe(false)
    expect(opened.snapshot.items).toEqual(expectedStored)
    await expect(opened.send('follow up')).rejects.toThrow('read-only')
    opened.close()
  } finally {
    f.clean()
  }
})

test('live running runs still open from the engine', async () => {
  const f = fakeService()
  try {
    const { store, routines } = makeRoutines(f, () => 0)
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

test('deleting a routine deletes its transcripts in the same transaction and blocks post-delete finish saves', async () => {
  const f = fakeService()
  try {
    let time = 0
    const { store, routines } = makeRoutines(f, () => time)
    const routine = await routines.create('b1', routineInput)
    f.engine.runRoutine = async (_id, _prompt, options) => {
      options.onChat('c1')
      return { status: 'completed', text: 'Done.', items: rawItems }
    }
    time = 300_000
    const [run1] = store.claimDue(time)
    await routines.run(run1)
    expect(f.database.query('SELECT COUNT(*) AS n FROM routine_run_transcripts').get()).toEqual({ n: 1 })

    let releaseRun2!: () => void
    const started = new Promise<void>(resolve => {
      f.engine.runRoutine = async (_id, _prompt, options) => {
        options.onChat('c2')
        resolve()
        await new Promise<void>(done => {
          releaseRun2 = done
        })
        return { status: 'completed', text: 'Late.', items: rawItems }
      }
    })
    time = 600_000
    const [run2] = store.claimDue(time)
    const inFlight = routines.run(run2)
    await started

    await routines.delete('b1', routine.id)
    expect(f.database.query('SELECT COUNT(*) AS n FROM routine_run_transcripts').get()).toEqual({ n: 0 })

    releaseRun2()
    await inFlight
    expect(f.database.query('SELECT COUNT(*) AS n FROM routine_run_transcripts').get()).toEqual({ n: 0 })
  } finally {
    f.database.close()
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('deleting a webhook deletes its transcripts in the same transaction and blocks post-delete finish saves', async () => {
  const f = await webhookFixture()
  try {
    f.engine.runRoutine = async (_id, _prompt, options) => {
      options.onChat('wh-c1')
      return { status: 'completed', text: 'Done.', items: rawItems }
    }
    f.send('{"n":1}')
    await f.tick(f.now() + WEBHOOK_LIMITS.quietMs)
    expect(f.database.query('SELECT COUNT(*) AS n FROM webhook_run_transcripts').get()).toEqual({ n: 1 })

    let releaseRun2!: () => void
    const started = new Promise<void>(resolve => {
      f.engine.runRoutine = async (_id, _prompt, options) => {
        options.onChat('wh-c2')
        resolve()
        await new Promise<void>(done => {
          releaseRun2 = done
        })
        return { status: 'completed', text: 'Late.', items: rawItems }
      }
    })
    f.send('{"n":2}')
    const claimAt = f.now() + WEBHOOK_LIMITS.gapMs + WEBHOOK_LIMITS.quietMs + 1000
    f.webhooks.store.claimDue(claimAt)
    const [pending] = f.webhooks.store.pending()
    const inFlight = f.webhooks.run(pending)
    await started

    await f.webhooks.delete('b1', f.hook.id)
    expect(f.database.query('SELECT COUNT(*) AS n FROM webhook_run_transcripts').get()).toEqual({ n: 0 })

    releaseRun2()
    await inFlight
    expect(f.database.query('SELECT COUNT(*) AS n FROM webhook_run_transcripts').get()).toEqual({ n: 0 })
  } finally {
    f.clean()
  }
})
