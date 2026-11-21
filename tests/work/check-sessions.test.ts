import { expect, test } from 'bun:test'
import { botCapability } from '../../server/bots/bot-capability'
import type { BotService } from '../../server/bots/bot-service'
import { openDatabase } from '../../server/database/database'
import type { BotEngine } from '../../server/engines/bot-engine'
import { HistoryService } from '../../server/history/history-service'
import { HistoryStore } from '../../server/history/history-store'
import { createEngineApi } from '../../server/http/engine-api'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import { checkSessions, NO_MEMORY } from '../../server/work/check-sessions'
import { WorkCheckStore } from '../../server/work/work-check-store'

/** A check of bot `b` under way in session `check-live` (also known as `check-stored`), and what the engine reads. */
function checking() {
  const database = openDatabase(':memory:')
  const checks = new WorkCheckStore(database)
  const check = checks.add('item-1', { kind: 'bot', id: 'b', name: 'B' }, null, null, 1)
  checks.attach(check.id, 'check-live')
  checks.attach(check.id, 'check-stored')
  const roots = new Map<string, string | null>([['check-continued', 'check-stored']])
  const sessions = checkSessions(checks, (_bot, chat) => (roots.has(chat) ? roots.get(chat)! : chat))
  return { database, checks, check, roots, sessions }
}

test('a check session is known by either id and after compressing; an unreadable lineage counts as one only while the bot checks', () => {
  const { checks, check, roots, sessions } = checking()
  for (const chat of ['check-live', 'check-stored', 'check-continued']) expect(sessions.isCheck('b', chat)).toBe(true)
  expect(sessions.isCheck('b', 'b-main')).toBe(false)
  roots.set('unreadable', null)
  expect(sessions.isCheck('b', 'unreadable')).toBe(true)
  expect(sessions.memoryRefusal('b', undefined)).toBe(NO_MEMORY)
  expect(sessions.memoryRefusal('other', undefined)).toBeNull()
  checks.settle(check.id, 'verified', 'seen', null, 2)
  expect(sessions.isCheck('b', 'unreadable')).toBe(false)
  expect(sessions.memoryRefusal('b', undefined)).toBeNull()
  expect(sessions.isCheck('b', 'check-live')).toBe(true)
})

test('the engine API gives a check session an empty memory block and refuses its recall, writes, forgets and conversation search', async () => {
  const { database, sessions } = checking()
  const memory = new MemoryService(new MemoryStore(database), () => Date.UTC(2026, 10, 21))
  memory.write({ botId: 'b', kind: 'profile', text: 'Oscar wants the report by Friday', author: 'bot', via: 'chat' })
  const history = new HistoryStore(database)
  history.session('b', 'b-main', 1)
  history.write('b', 'b-main', [{ id: 'm', at: 1, order: 1, item: { kind: 'user', text: 'the report is done' } }])
  const api = createEngineApi(memory, 'test-token', 4321, {
    history: new HistoryService(
      history,
      {} as BotEngine,
      async () => [],
      () => true
    ),
    bots: { listBots: async () => [{ id: 'b' }] } as unknown as BotService,
    botExists: id => id === 'b',
    deploymentNotice: () => 'the last deploy failed',
    memoryRefusal: sessions.memoryRefusal
  })
  const post = async (path: string, body: Record<string, unknown>) => {
    const reply = await api(
      new Request(`http://127.0.0.1:4321${path}`, {
        method: 'POST',
        headers: { host: '127.0.0.1:4321', authorization: 'Bearer test-token', 'x-lilbot-bot-capability': botCapability('test-token', 'b') },
        body: JSON.stringify(body)
      }),
      path
    )
    return { status: reply.status, body: (await reply.json()) as any }
  }
  const inCheck = { botId: 'b', chatId: 'check-continued' }
  expect(await post('/engine/memory/context', inCheck)).toEqual({ status: 200, body: { text: '', shown: 0, total: 0 } })
  expect((await post('/engine/memory/context', { botId: 'b', chatId: 'b-main' })).body.text).toContain('report by Friday')
  for (const [path, body] of [
    ['/engine/memory/recall', { query: 'report' }],
    ['/engine/memory/write', { kind: 'profile', text: 'The report was checked' }],
    ['/engine/memory/forget', { id: 'abcd' }],
    ['/engine/history/search', { query: 'report' }]
  ] as const)
    expect(await post(path, { ...inCheck, ...body })).toEqual({ status: 422, body: { error: NO_MEMORY } })
  expect((await post('/engine/history/search', { chatId: 'b-main', query: 'report' })).body.matches).toHaveLength(1)
  expect(memory.recall('b', 'checked')).toEqual([])
})
