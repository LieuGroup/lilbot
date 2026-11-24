import { expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { botCapability } from '../../server/bots/bot-capability'
import { BrowserSession } from '../../server/http/browser-session'
import { createEngineApi } from '../../server/http/engine-api'
import { MemoryReviewer } from '../../server/memory/memory-reviewer'
import { RoutineService } from '../../server/routines/routine-service'
import { RoutineStore } from '../../server/routines/routine-store'
import { fakeService } from '../helpers/fake-engine'

test('HTTP capabilities bind routines to caller; cross-bot, missing and deleted credentials are refused', async () => {
  const f = fakeService()
  try {
    const routines = new RoutineService(new RoutineStore(f.database), f.service)
    const other = await f.service.createBot({ name: 'Other', function: '', instructions: '' })
    const handle = createEngineApi(f.memory, 'test', 3371, { bots: f.service, botExists: id => f.store.exists(id), routines })
    const call = async (action: string, body: object, capability = botCapability('test', 'b1'), origin?: string) =>
      handle(
        new Request(`http://localhost:3371/engine/routines/${action}`, {
          method: 'POST',
          headers: { host: 'localhost:3371', authorization: 'Bearer test', 'x-lilbot-bot-capability': capability, ...(origin ? { origin } : {}) },
          body: JSON.stringify(body)
        }),
        `/engine/routines/${action}`
      )
    const created = (await (
      await call('create', { botId: other.id, requestId: 'first', description: 'Check', schedule: { kind: 'interval', seconds: 300 }, createdBy: 'bot' })
    ).json()) as any
    expect(created.botId).toBe('b1')
    expect((await routines.list(other.id)).length).toBe(0)
    expect((await call('pause', { id: created.id }, botCapability('test', other.id))).status).toBe(422)
    expect((await call('list', {}, '')).status).toBe(403)
    expect((await call('list', {}, undefined, 'http://localhost:3371')).status).toBe(403)
    f.store.markDeleted(f.store.get('b1'), { files: 'delete', privateMemories: 'forget' })
    expect((await call('list', {})).status).toBe(403)
    expect(routines.store.claimDue(Date.now() + 900_000)).toEqual([])
  } finally {
    f.database.close()
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('routine aliases are excluded from checkpoint saves and review queueing after restart', async () => {
  const f = fakeService()
  try {
    const store = new RoutineStore(f.database)
    store.create('b1', { requestId: 'one', description: 'Check', schedule: { kind: 'interval', seconds: 300 }, createdBy: 'oscar' }, 0, 5)
    const [run] = store.claimDue(300_000)
    store.attach(run.id, 'live-id', 300_000)
    store.attach(run.id, 'stored-id', 300_000)
    const restarted = new RoutineStore(f.database)
    const reviewer = new MemoryReviewer(f.queue, f.engine)
    const chatKind = (_bot: string, chat: string) => (restarted.isRoutineChat(chat) ? ('lilbot' as const) : ('conversation' as const))
    const handle = createEngineApi(f.memory, 'test', 3371, {
      bots: f.service,
      history: {} as never,
      botExists: () => true,
      chatKind,
      reviewer
    })
    for (const chatId of ['live-id', 'stored-id']) {
      const res = await handle(
        new Request('http://localhost:3371/engine/history/save', {
          method: 'POST',
          headers: { host: 'localhost:3371', authorization: 'Bearer test', 'x-lilbot-bot-capability': botCapability('test', 'b1') },
          body: JSON.stringify({ chatId, messages: [{ role: 'user', text: 'hello' }] })
        }),
        '/engine/history/save'
      )
      expect(await res.json()).toEqual({ saved: false, skipped: true })
    }
    const real = await handle(
      new Request('http://localhost:3371/engine/history/save', {
        method: 'POST',
        headers: { host: 'localhost:3371', authorization: 'Bearer test', 'x-lilbot-bot-capability': botCapability('test', 'b1') },
        body: JSON.stringify({ chatId: 'real-chat', messages: [{ role: 'user', text: 'hello' }] })
      }),
      '/engine/history/save'
    )
    expect(await real.json()).toEqual({ saved: true, passes: 1 })
    expect(f.log.filter(line => line.startsWith('review:'))).toHaveLength(1)
  } finally {
    f.database.close()
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('browser methods list, pause, resume, open an independent run and delete', async () => {
  const f = fakeService()
  try {
    const store = new RoutineStore(f.database)
    const routines = new RoutineService(store, f.service)
    const routine = await routines.create('b1', { requestId: 'one', description: 'Check', schedule: { kind: 'interval', seconds: 300 }, createdBy: 'oscar' })
    const [run] = store.claimDue(Date.now() + 400_000)
    f.stored.add('routine-chat')
    store.attach(run.id, 'routine-chat', Date.now())
    const frames: any[] = []
    const browser = new BrowserSession(f.service, frame => frames.push(frame), f.activity, routines)
    const call = async (method: string, params: object) => {
      await browser.handle(JSON.stringify({ id: frames.length, method, params }))
      return frames.at(-1)
    }
    expect((await call('routines.list', { botId: 'b1' })).result[0].id).toBe(routine.id)
    expect((await call('routines.pause', { botId: 'b1', id: routine.id })).ok).toBe(true)
    expect((await call('routines.resume', { botId: 'b1', id: routine.id })).ok).toBe(true)
    expect((await call('routines.openRun', { botId: 'b1', runId: run.id })).result.chatId).toBe('routine-chat')
    expect(f.prefs.mainChat('b1')).toBeNull()
    expect((await call('routines.delete', { botId: 'b1', id: routine.id })).ok).toBe(true)
    browser.close()
  } finally {
    f.activity.close()
    f.database.close()
    rmSync(f.root, { recursive: true, force: true })
  }
})
