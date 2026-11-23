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
import type { SkillsService } from '../../server/skills/skills-service'
import { checkSessions, NO_CHANGES, NO_COMPUTERS, NO_MEMORY, NO_SKILLS } from '../../server/work/check-sessions'
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
  expect(sessions.refusal('b', undefined, 'memory')).toBe(NO_MEMORY)
  expect(sessions.refusal('b', 'b-main', 'memory')).toBeNull()
  expect(sessions.refusal('other', undefined, 'memory')).toBeNull()
  checks.settle(check.id, 'verified', 'seen', null, 2)
  expect(sessions.isCheck('b', 'unreadable')).toBe(false)
  expect(sessions.refusal('b', undefined, 'memory')).toBeNull()
  expect(sessions.isCheck('b', 'check-live')).toBe(true)
})

test('the engine API gives a check session an empty memory block and refuses its recall, writes, forgets, conversation search and skill changes', async () => {
  const { database, checks, check, sessions } = checking()
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
    skills: { write: () => ({ written: true }) } as unknown as SkillsService,
    inCheck: sessions.refusal
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
  // A skill change names no session, so none is made while the bot checks.
  const skill = { name: 'notes', action: 'create', content: '---\nname: notes\ndescription: Notes\n---\nWrite notes.' }
  expect(await post('/engine/skills/write', skill)).toEqual({ status: 422, body: { error: NO_SKILLS } })
  checks.settle(check.id, 'verified', 'seen', null, 2)
  expect(await post('/engine/skills/write', skill)).toEqual({ status: 200, body: { written: true } })
})

test('the engine API refuses computers and mutating legacy routes from a check session while allowing reads and other sessions', async () => {
  const { database, checks, check, sessions } = checking()
  const memory = new MemoryService(new MemoryStore(database), () => Date.UTC(2026, 10, 21))
  let computerCalls = 0
  let botCreates = 0
  let routineCreates = 0
  let threadAsks = 0
  let libraryGives = 0
  const api = createEngineApi(memory, 'test-token', 4321, {
    bots: {
      listBots: async () => [{ id: 'b', name: 'B', function: '' }],
      createFromBot: async () => {
        botCreates++
        return { id: 'new' }
      }
    } as unknown as BotService,
    botExists: id => id === 'b',
    computers: {
      list: () => {
        computerCalls++
        return [{ id: 'leader', name: 'Leader' }]
      },
      submit: async () => {
        computerCalls++
        return { id: 'req-1' }
      }
    } as never,
    routines: {
      list: () => [],
      create: async () => {
        routineCreates++
        return { id: 'r1' }
      }
    } as never,
    threads: {
      list: async () => [],
      ask: async () => {
        threadAsks++
        return { threadId: 't1', queued: true }
      }
    } as never,
    library: {
      give: async () => {
        libraryGives++
        return { id: 'l1' }
      }
    } as never,
    skills: {
      offered: () => [{ name: 'lilbot-check' }],
      read: () => ({ 'SKILL.md': '# Check' }),
      write: () => ({ written: true })
    } as unknown as SkillsService,
    inCheck: sessions.refusal
  })
  const post = async (path: string, body: Record<string, unknown>, session?: string) => {
    const headers: Record<string, string> = {
      host: '127.0.0.1:4321',
      authorization: 'Bearer test-token',
      'x-lilbot-bot-capability': botCapability('test-token', 'b')
    }
    if (session) headers['x-lilbot-session'] = session
    const reply = await api(new Request(`http://127.0.0.1:4321${path}`, { method: 'POST', headers, body: JSON.stringify(body) }), path)
    return { status: reply.status, body: (await reply.json()) as any }
  }

  // Computers: refused from check session (direct, compressed continuation, or missing header while checking).
  expect(await post('/engine/computers/list', {}, 'check-live')).toEqual({ status: 422, body: { error: NO_COMPUTERS } })
  expect(await post('/engine/computers/submit', { computer: 'leader', requestId: 'r1', operation: { kind: 'exec', command: 'echo hi' } }, 'check-continued')).toEqual({
    status: 422,
    body: { error: NO_COMPUTERS }
  })
  expect(await post('/engine/computers/submit', { computer: 'leader', requestId: 'r2', operation: { kind: 'exec', command: 'echo hi' } })).toEqual({
    status: 422,
    body: { error: NO_COMPUTERS }
  })
  // Another non-check session of the same bot still reaches computers while the check runs.
  expect((await post('/engine/computers/list', {}, 'b-main')).status).toBe(200)
  expect(computerCalls).toBe(1)

  // Sibling mutating engine routes: refused in check session; read-only siblings stay allowed.
  expect(await post('/engine/bots/create', { requestId: 'c1', name: 'X', function: 'x', instructions: 'x' }, 'check-live')).toEqual({ status: 422, body: { error: NO_CHANGES } })
  expect(await post('/engine/routines/create', { requestId: 'r1', description: 'd', schedule: { kind: 'interval', minutes: 10 } }, 'check-live')).toEqual({
    status: 422,
    body: { error: NO_CHANGES }
  })
  expect(await post('/engine/threads/ask', { requestId: 't1', to: 'other', text: 'hi', chatId: 'check-live' })).toEqual({ status: 422, body: { error: NO_CHANGES } })
  expect(await post('/engine/library/give', { path: 'a.txt', title: 'A', chatId: 'check-live' })).toEqual({ status: 422, body: { error: NO_CHANGES } })
  expect([botCreates, routineCreates, threadAsks, libraryGives]).toEqual([0, 0, 0, 0])

  expect((await post('/engine/routines/list', {}, 'check-live')).status).toBe(200)
  expect((await post('/engine/threads/list', {}, 'check-live')).status).toBe(200)
  expect((await post('/engine/skills/list', {}, 'check-live')).status).toBe(200)
  expect((await post('/engine/skills/read', { name: 'lilbot-check' }, 'check-live')).status).toBe(200)

  // Even after the check settles, calls naming that check session remain refused.
  checks.settle(check.id, 'verified', 'seen', null, 2)
  expect((await post('/engine/computers/list', {}, 'check-live')).status).toBe(422)
  expect((await post('/engine/skills/write', { name: 'notes', action: 'create', content: '---\nname: notes\ndescription: N\n---\nBody' }, 'check-live')).status).toBe(422)
  expect((await post('/engine/computers/list', {})).status).toBe(200)
})
