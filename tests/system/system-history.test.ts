import { expect, spyOn, test } from 'bun:test'
import { excludeSession } from '../../server/history/history-exclusion'
import { addBot, systemFixture } from './system-fixture'

const msg = (id: string, at: number, text: string, kind: 'user' | 'assistant' = 'user') => ({ id, at, order: at, item: { kind, text } })

test('lilbot_history_search searches only the caller’s own conversation, accepts no botId, and agrees with HistoryService.search', async () => {
  const f = systemFixture()
  const other = await addBot(f, 'Other')

  const listed = (await (await f.rpc('b1', 'tools/list')).json()).result.tools as { name: string; inputSchema: { properties?: Record<string, unknown> } }[]
  const schema = listed.find(t => t.name === 'lilbot_history_search')
  expect(schema).toBeDefined()
  expect(Object.keys(schema!.inputSchema.properties ?? {}).sort()).toEqual(['limit', 'query'])

  f.history.session('b1', 's1', 100)
  f.history.write('b1', 's1', [msg('m1', 101, 'orchid copper calibration code'), msg('m2', 102, 'orchid copper noted', 'assistant')], 'c1', true)
  f.history.discovered('b1')

  f.history.session(other.id, 'o1', 200)
  f.history.write(other.id, 'o1', [msg('om1', 201, 'orchid secret belonging to other bot'), msg('om2', 202, 'velvet unique phrase')], 'c2', true)
  f.history.discovered(other.id)

  // Ordinary bot is never held or slowed by CallingChats.gate.
  const gate = spyOn(f.calls, 'gate')
  const mcpRes = (await f.call('b1', 'lilbot_history_search', { query: 'orchid' }, false)).data
  expect(gate).not.toHaveBeenCalled()
  gate.mockRestore()

  expect(mcpRes).toEqual(f.historyService.search('b1', 'orchid', 20))
  expect(mcpRes.matches.map((m: { id: string }) => m.id).sort()).toEqual(['m1', 'm2'])
  expect(mcpRes.import).toEqual({ sessions: 1, completed: 1, items: 2, complete: true })

  // Extra botId argument is ignored; another bot's hits and counts are never revealed.
  const forged = (await f.call('b1', 'lilbot_history_search', { query: 'velvet', botId: other.id }, false)).data
  expect(forged).toEqual({ matches: [], import: { sessions: 1, completed: 1, items: 2, complete: true } })
  expect(JSON.stringify(forged)).not.toContain('velvet')
  expect(JSON.stringify(forged)).not.toContain(other.id)

  // Validation, limits, punctuation-only query, and read-only change-log silence match HistoryService.search.
  expect((await f.call('b1', 'lilbot_history_search', { query: 'orchid', limit: 1 }, false)).data).toEqual(f.historyService.search('b1', 'orchid', 1))
  expect((await f.call('b1', 'lilbot_history_search', { query: '!!!' }, false)).data).toEqual(f.historyService.search('b1', '!!!', 20))
  expect((await f.call('b1', 'lilbot_history_search', { query: '   ' }, false)).error).toContain('Invalid arguments')
  expect((await f.call('b1', 'lilbot_history_search', { query: 'orchid', limit: 0 }, false)).error).toContain('Invalid arguments')
  expect((await f.call('b1', 'lilbot_history_search', { query: 'orchid', limit: 51 }, false)).error).toContain('Invalid arguments')
  expect(f.changes.recent(10)).toEqual([])
})

test('hidden sessions (routines, webhooks, exchanges, reviews, checks), their continuations, exclusions and unreadable lineage stay excluded', async () => {
  const f = systemFixture()
  const seed = (session: string, id: string, text: string) => {
    f.history.session('b1', session, 10)
    f.history.write('b1', session, [msg(id, 11, text)], 'c', true)
  }

  // Register one real hidden session of every kind plus a compression continuation for each.
  const routine = f.routineStore.create('b1', { requestId: 'r1', description: 'Nightly', schedule: { kind: 'daily', time: '08:00', timeZone: 'UTC' }, createdBy: 'oscar' }, 1, 5)
  const [rRun] = f.routineStore.claimDue(routine.nextRunAt)
  f.routineStore.attach(rRun.id, 'routine-chat', 1)

  const hook = await f.webhooks.create('b1', { requestId: 'w1', description: 'CI', source: 'GitHub', createdBy: 'oscar' })
  f.database.query("INSERT INTO webhook_runs (id, webhook_id, bot_id, created_at, status) VALUES ('wrun-1', ?, 'b1', 1, 'running')").run(hook.id)
  f.webhookStore.attach('wrun-1', 'webhook-chat', 1)

  f.database.query('INSERT INTO thread_chats(thread_id, bot_id, chat_id) VALUES(?,?,?)').run('t-1', 'b1', 'exchange-chat')

  const check = f.work.work.checks.add('item-1', { kind: 'bot', id: 'b1', name: 'B1' }, null, null, 1)
  f.work.work.checks.attach(check.id, 'check-chat')

  f.reviewChats.add('review-chat')

  const continuations: [string, string][] = [
    ['routine-cont', 'routine-chat'],
    ['webhook-cont', 'webhook-chat'],
    ['exchange-cont', 'exchange-chat'],
    ['check-cont', 'check-chat'],
    ['review-cont', 'review-chat']
  ]
  for (const [child, root] of continuations) f.roots.set(child, root)
  f.roots.set('unreadable-chat', null)

  // Seed rows for every hidden session, every continuation, unreadable lineage, an excluded session, and two main sessions.
  const hiddenSessions = [
    'routine-chat',
    'routine-cont',
    'webhook-chat',
    'webhook-cont',
    'exchange-chat',
    'exchange-cont',
    'check-chat',
    'check-cont',
    'review-chat',
    'review-cont',
    'unreadable-chat'
  ]
  for (const s of hiddenSessions) seed(s, `row-${s}`, `saffron secret from ${s}`)
  seed('excluded-chat', 'row-excluded', 'saffron excluded session')
  excludeSession(f.database, 'b1', 'excluded-chat', 'cleanup')
  seed('main-1', 'row-main-1', 'saffron visible one')
  seed('main-2', 'row-main-2', 'saffron visible two')

  // Calls from hidden check or narrow webhook continuations are refused; main conversation calls succeed.
  f.from.set('b1', 'check-cont')
  expect((await f.call('b1', 'lilbot_history_search', { query: 'saffron' })).error).toContain('This session is a check')
  f.from.set('b1', 'webhook-cont')
  expect((await f.call('b1', 'lilbot_history_search', { query: 'saffron' })).error).toContain('"memory"')
  f.from.set('b1', 'b1-main')

  // Even with limit: 1, hidden rows must be skipped so allowed main rows still fill the limit, and SQLite remains unlocked.
  const one = (await f.call('b1', 'lilbot_history_search', { query: 'saffron', limit: 1 })).data
  expect(one.matches).toHaveLength(1)
  expect(['main-1', 'main-2']).toContain(one.matches[0].sessionId)

  const all = (await f.call('b1', 'lilbot_history_search', { query: 'saffron' })).data
  expect(all.matches.map((m: { sessionId: string }) => m.sessionId).sort()).toEqual(['main-1', 'main-2'])

  // Once unreadable lineage recovers and resolves to a non-hidden session, it becomes searchable again.
  f.roots.set('unreadable-chat', 'unreadable-chat')
  const recovered = (await f.call('b1', 'lilbot_history_search', { query: 'saffron' })).data
  expect(recovered.matches.map((m: { sessionId: string }) => m.sessionId).sort()).toEqual(['main-1', 'main-2', 'unreadable-chat'])
})

test('default limit (20), snippet ellipsis (32 tokens) and ordering match HistoryService.search on long messages', async () => {
  const f = systemFixture()
  f.history.session('b1', 'long', 100)
  const filler = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')
  const rows = Array.from({ length: 25 }, (_, i) => msg(`r${i}`, 100 + i, `${filler} marigold entry${i} ${filler}`))
  f.history.write('b1', 'long', rows, 'c', true)
  f.history.discovered('b1')

  const mcpRes = (await f.call('b1', 'lilbot_history_search', { query: 'marigold' }, false)).data
  expect(mcpRes).toEqual(f.historyService.search('b1', 'marigold', 20))
  expect(mcpRes.matches).toHaveLength(20)
  expect(mcpRes.matches[0].snippet).toContain(' … ')
  expect(mcpRes.matches[0].snippet).toContain('marigold')
})
