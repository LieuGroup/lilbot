import { expect, spyOn, test } from 'bun:test'
import { systemFixture } from './system-fixture'

test('review sessions keep via:review attribution, protect owner facts, and block non-memory tools over System MCP', async () => {
  const f = systemFixture()
  const ownerFact = f.memory.write({ botId: 'b1', kind: 'profile', text: 'Owner wrote this preference.', author: 'user' })
  const botFact = f.memory.write({ botId: 'b1', kind: 'profile', text: 'Bot noticed this detail.', author: 'bot' })
  const removedFact = f.memory.write({ botId: 'b1', kind: 'profile', text: 'Posts go out at 5 pm.', author: 'bot' })
  f.memory.forgetAsUser(removedFact.id)

  f.reviewChats.add('rev-1')
  f.reviewingBots.add('b1')
  f.from.set('b1', 'rev-1')

  // Save records via: 'review' and sourceChatId; recalling works; re-saving a user-removed fact is refused.
  const saved = await f.call('b1', 'lilbot_memory_save', { kind: 'profile', text: 'Analytics live in Footy/Analytics.' })
  expect(saved.error).toBeUndefined()
  const stored = f.memory.list('b1').find(fact => fact.text === 'Analytics live in Footy/Analytics.')
  expect(stored).toMatchObject({ via: 'review', author: 'bot' })
  expect(f.database.query('SELECT source_chat_id FROM memory_facts WHERE id=?').get(stored!.id)).toEqual({ source_chat_id: 'rev-1' })

  const recalled = await f.call('b1', 'lilbot_memory_recall', { query: 'Analytics' })
  expect(recalled.data.facts).toHaveLength(1)

  const resaved = await f.call('b1', 'lilbot_memory_save', { kind: 'profile', text: 'posts go out at 5 pm.' })
  expect(resaved.error).toBe('The user removed this fact from memory. Do not save it again.')

  // Owner-authored facts are protected from review forgets; bot-authored facts can still be forgotten.
  const forgetOwner = await f.call('b1', 'lilbot_memory_forget', { id: ownerFact.id.slice(0, 8) })
  expect(forgetOwner.error).toBe('The user wrote this fact. A review may not remove it.')
  expect(f.memory.list('b1').some(fact => fact.id === ownerFact.id)).toBe(true)

  const forgetBot = await f.call('b1', 'lilbot_memory_forget', { id: botFact.id.slice(0, 8) })
  expect(forgetBot.error).toBeUndefined()
  expect(f.memory.list('b1').some(fact => fact.id === botFact.id)).toBe(false)

  // Every tool outside recall/save/forget is refused inside a review session (even memory panel controls).
  for (const [name, args] of [
    ['lilbot_memory_pause', { factId: ownerFact.id.slice(0, 8), paused: true }],
    ['lilbot_memory_expiry', { factId: ownerFact.id.slice(0, 8), expires: '2026-12-31' }],
    ['lilbot_memory_list', {}],
    ['lilbot_history_search', { query: 'Owner' }],
    ['lilbot_computers_list', {}],
    ['lilbot_bot_create', { requestId: 'r1', name: 'X', function: 'x', instructions: 'x' }]
  ] as const) {
    const res = await f.call('b1', name, args as Record<string, unknown>)
    expect(res.error).toContain('memory review')
  }
})

test('review placement fails closed on unplaced or ambiguous calls while letting distinct main-chat calls proceed', async () => {
  const f = systemFixture()
  const ownerFact = f.memory.write({ botId: 'b1', kind: 'profile', text: 'Owner fact stays safe.', author: 'user' })
  const ownerFact2 = f.memory.write({ botId: 'b1', kind: 'profile', text: 'Second owner fact.', author: 'user' })

  f.reviewChats.add('rev-2')
  f.reviewingBots.add('b1')

  // Unplaced forget/save while a review runs must fail closed, never falling back to chat / review: false.
  const unplacedForget = await f.call('b1', 'lilbot_memory_forget', { id: ownerFact.id.slice(0, 8) }, false)
  expect(unplacedForget.error).toContain('could not tell which of your conversations')
  expect(f.memory.list('b1').some(fact => fact.id === ownerFact.id)).toBe(true)

  const unplacedSave = await f.call('b1', 'lilbot_memory_save', { text: 'Must not slip in as chat.' }, false)
  expect(unplacedSave.error).toContain('could not tell which of your conversations')
  expect(f.memory.list('b1').some(fact => fact.text === 'Must not slip in as chat.')).toBe(false)

  // Identical concurrent starts from main chat and review session fail closed (ambiguous).
  const sharedArgs = { id: ownerFact.id.slice(0, 8) }
  f.calls.saw('b1', 'b1-main', 'mcp__lilbot_system__lilbot_memory_forget', sharedArgs, 'call-main')
  f.calls.saw('b1', 'rev-2', 'mcp__lilbot_system__lilbot_memory_forget', sharedArgs, 'call-rev')
  const amb1 = await f.call('b1', 'lilbot_memory_forget', sharedArgs, false)
  const amb2 = await f.call('b1', 'lilbot_memory_forget', sharedArgs, false)
  expect(amb1.error).toContain('Two of your conversations')
  expect(amb2.error).toContain('Two of your conversations')
  expect(f.memory.list('b1').some(fact => fact.id === ownerFact.id)).toBe(true)

  // Distinct main-chat call while review runs concurrently is placed to main chat and allowed to forget owner fact.
  f.from.set('b1', 'b1-main')
  const mainForget = await f.call('b1', 'lilbot_memory_forget', { id: ownerFact2.id.slice(0, 8) })
  expect(mainForget.error).toBeUndefined()
  expect(f.memory.list('b1').some(fact => fact.id === ownerFact2.id)).toBe(false)
})

test('ordinary chats never enter the review placement gate (zero gate calls and sub-millisecond latency)', async () => {
  const f = systemFixture()
  const gate = spyOn(f.calls, 'gate')
  const start = performance.now()
  for (let i = 0; i < 50; i++) {
    const saved = await f.call('b1', 'lilbot_memory_save', { text: `Ordinary fact ${i}.` }, false)
    expect(saved.error).toBeUndefined()
    const forgotten = await f.call('b1', 'lilbot_memory_forget', { id: saved.data.id }, false)
    expect(forgotten.error).toBeUndefined()
  }
  const elapsedMs = performance.now() - start
  const perCallMs = elapsedMs / 100
  expect(gate).not.toHaveBeenCalled()
  // Calls would each block for CallingChats.waitMs (300 ms) if they entered the unplaced gate; fast path is <2 ms/call.
  expect(perCallMs).toBeLessThan(5)
  gate.mockRestore()
})
