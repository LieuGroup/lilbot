import { expect, spyOn, test } from 'bun:test'
import { connectionKey } from '../../server/connections/connection-keys'
import { assertReviewRunOk } from '../../server/memory/review-run'
import { SESSION_MCP_PATH, SYSTEM_KEY_PURPOSE, sessionMcpKey } from '../../server/system/system-connection'
import { addBot, systemFixture } from './system-fixture'

const TOKEN = 'engine-token-for-tests'
const reviewKey = (botId: string, runId: string) => `Bearer ${sessionMcpKey(TOKEN, botId, 'review', runId)}`
const systemKey = (botId: string) => `Bearer ${connectionKey(TOKEN, SYSTEM_KEY_PURPOSE, botId)}`

const PORT = 3997
const reviewReq = (f: ReturnType<typeof systemFixture>, path: string, message: unknown, headers: Record<string, string>, method = 'POST') =>
  f.reviewHandler(
    new Request(`http://127.0.0.1:${PORT}${path}`, {
      method,
      headers: { host: `127.0.0.1:${PORT}`, ...headers },
      body: method === 'POST' ? JSON.stringify(message) : undefined
    })
  )

async function reviewCall(f: ReturnType<typeof systemFixture>, botId: string, runId: string, name: string, args: Record<string, unknown> = {}) {
  const res = await reviewReq(
    f,
    `${SESSION_MCP_PATH}?run=${encodeURIComponent(runId)}`,
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    { authorization: reviewKey(botId, runId) }
  )
  const payload = (await res.json()) as { result?: { isError?: boolean; content: { text: string }[] } }
  const text = payload.result?.content?.[0]?.text ?? ''
  return payload.result?.isError ? { status: res.status, error: text } : { status: res.status, data: JSON.parse(text) }
}

test('dedicated review MCP exposes only recall/save/forget, marks via:review, protects owner facts, and blocks other tools', async () => {
  const f = systemFixture()
  const ownerFact = f.memory.write({ botId: 'b1', kind: 'profile', text: 'Owner wrote this preference.', author: 'user' })
  const botFact = f.memory.write({ botId: 'b1', kind: 'profile', text: 'Bot noticed this detail.', author: 'bot' })
  const removedFact = f.memory.write({ botId: 'b1', kind: 'profile', text: 'Posts go out at 5 pm.', author: 'bot' })
  f.memory.forgetAsUser(removedFact.id)

  const run = f.startReviewRun('b1')
  run.setChat('rev-1')
  expect(run.connection.url).not.toContain('Owner')

  const listRes = await reviewReq(
    f,
    `${SESSION_MCP_PATH}?run=${run.runId}`,
    { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    { authorization: reviewKey('b1', run.runId) }
  )
  expect(listRes.status).toBe(200)
  const listed = ((await listRes.json()) as { result: { tools: { name: string }[] } }).result.tools.map(t => t.name)
  expect([...listed].sort()).toEqual(['lilbot_memory_forget', 'lilbot_memory_recall', 'lilbot_memory_save'])

  const saved = await reviewCall(f, 'b1', run.runId, 'lilbot_memory_save', { kind: 'profile', text: 'Analytics live in Footy/Analytics.' })
  expect(saved.error).toBeUndefined()
  const stored = f.memory.list('b1').find(fact => fact.text === 'Analytics live in Footy/Analytics.')
  expect(stored).toMatchObject({ via: 'review', author: 'bot' })
  expect(f.database.query('SELECT source_chat_id FROM memory_facts WHERE id=?').get(stored!.id)).toEqual({ source_chat_id: 'rev-1' })

  // Change log never records fact text.
  expect(JSON.stringify(f.changes.recent(10))).not.toContain('Footy/Analytics')

  const recalled = await reviewCall(f, 'b1', run.runId, 'lilbot_memory_recall', { query: 'Analytics' })
  expect(recalled.data.facts).toHaveLength(1)

  const resaved = await reviewCall(f, 'b1', run.runId, 'lilbot_memory_save', { kind: 'profile', text: 'posts go out at 5 pm.' })
  expect(resaved.error).toBe('The user removed this fact from memory. Do not save it again.')

  const forgetOwner = await reviewCall(f, 'b1', run.runId, 'lilbot_memory_forget', { id: ownerFact.id.slice(0, 8) })
  expect(forgetOwner.error).toBe('The user wrote this fact. A review may not remove it.')
  expect(f.memory.list('b1').some(fact => fact.id === ownerFact.id)).toBe(true)

  const forgetBot = await reviewCall(f, 'b1', run.runId, 'lilbot_memory_forget', { id: botFact.id.slice(0, 8) })
  expect(forgetBot.error).toBeUndefined()
  expect(f.memory.list('b1').some(fact => fact.id === botFact.id)).toBe(false)

  const summary = run.finish()
  expect(summary.listed).toBe(true)
  expect(summary.hardFailures).toBe(0)
  expect(summary.domainRefusals).toEqual({ fact_removed_by_user: 1, fact_protected: 1 })
  expect(() => assertReviewRunOk(summary)).not.toThrow()

  // Any tool outside recall/save/forget is refused and records a hard failure.
  const run2 = f.startReviewRun('b1')
  await reviewReq(f, `${SESSION_MCP_PATH}?run=${run2.runId}`, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, { authorization: reviewKey('b1', run2.runId) })
  for (const name of ['lilbot_memory_pause', 'lilbot_memory_expiry', 'lilbot_memory_list', 'lilbot_history_search', 'lilbot_computers_list', 'lilbot_bot_create']) {
    const res = await reviewCall(f, 'b1', run2.runId, name, {})
    expect(res.error).toContain('not available in a memory review')
  }
  expect(run2.finish().hardFailures).toBe(6)
})

test('review MCP enforces loopback Host, no Origin, per-session key, live run id, and cross-bot/cross-session isolation', async () => {
  const f = systemFixture()
  const b2 = await addBot(f, 'Beta')
  const privateFact = f.memory.write({ botId: 'b1', kind: 'profile', scope: 'bot', text: 'Alpha private secret note.', author: 'bot' })
  const run1 = f.startReviewRun('b1')
  const run1b = f.startReviewRun('b1')
  const run2 = f.startReviewRun(b2.id)
  const listMsg = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }

  // Browser Origin or non-loopback Host refused.
  expect((await reviewReq(f, `${SESSION_MCP_PATH}?run=${run1.runId}`, listMsg, { authorization: reviewKey('b1', run1.runId), origin: 'https://evil.test' })).status).toBe(403)
  expect(
    (
      await f.reviewHandler(
        new Request(`http://127.0.0.1:${PORT}${SESSION_MCP_PATH}?run=${run1.runId}`, {
          method: 'POST',
          headers: { host: `evil.test:${PORT}`, authorization: reviewKey('b1', run1.runId) },
          body: JSON.stringify(listMsg)
        })
      )
    ).status
  ).toBe(403)

  // Ordinary lilbot-system key refused on session route; session key refused on ordinary route; another session's or scope's key refused.
  expect((await reviewReq(f, `${SESSION_MCP_PATH}?run=${run1.runId}`, listMsg, { authorization: systemKey('b1') })).status).toBe(403)
  expect((await f.request(listMsg, { authorization: reviewKey('b1', run1.runId) })).status).toBe(403)
  expect((await reviewReq(f, `${SESSION_MCP_PATH}?run=${run1.runId}`, listMsg, { authorization: reviewKey('b1', run1b.runId) })).status).toBe(403)
  expect((await reviewReq(f, `${SESSION_MCP_PATH}?run=${run1.runId}`, listMsg, { authorization: `Bearer ${sessionMcpKey(TOKEN, 'b1', 'check', run1.runId)}` })).status).toBe(403)

  // Missing run id, unknown run id, wrong bot's run id, and finished run id are all refused (403).
  expect((await reviewReq(f, SESSION_MCP_PATH, listMsg, { authorization: reviewKey('b1', run1.runId) })).status).toBe(403)
  expect((await reviewReq(f, `${SESSION_MCP_PATH}?run=no-such-run`, listMsg, { authorization: reviewKey('b1', 'no-such-run') })).status).toBe(403)
  expect((await reviewReq(f, `${SESSION_MCP_PATH}?run=${run1.runId}`, listMsg, { authorization: reviewKey(b2.id, run1.runId) })).status).toBe(403)

  // Bot 2 cannot recall or forget Bot 1's private fact.
  const crossRecall = await reviewCall(f, b2.id, run2.runId, 'lilbot_memory_recall', { query: 'Alpha' })
  expect(crossRecall.data.facts).toEqual([])
  const crossForget = await reviewCall(f, b2.id, run2.runId, 'lilbot_memory_forget', { id: privateFact.id.slice(0, 8) })
  expect(crossForget.error).toBe('No remembered fact has that id.')
  expect(f.memory.list('b1').some(fact => fact.id === privateFact.id)).toBe(true)

  // Finished run id is immediately refused.
  run1.finish()
  run1b.finish()
  run2.finish()
  expect((await reviewReq(f, `${SESSION_MCP_PATH}?run=${run1.runId}`, listMsg, { authorization: reviewKey('b1', run1.runId) })).status).toBe(403)

  // Deleted bot's key is immediately refused even if a run existed before deletion.
  const run3 = f.startReviewRun(b2.id)
  f.store.markDeleted(f.store.get(b2.id), { files: 'delete', privateMemories: 'forget' }, false)
  expect((await reviewReq(f, `${SESSION_MCP_PATH}?run=${run3.runId}`, listMsg, { authorization: reviewKey(b2.id, run3.runId) })).status).toBe(403)
  run3.finish()
})

test('stale starts and concurrent main-chat calls never touch CallingChats.gate or cross-contaminate reviews', async () => {
  const f = systemFixture()
  const ownerFact = f.memory.write({ botId: 'b1', kind: 'profile', text: 'Owner fact stays protected from review.', author: 'user' })
  const mainFactToForget = f.memory.write({ botId: 'b1', kind: 'profile', text: 'Owner wants to forget this in chat.', author: 'user' })
  const gateSpy = spyOn(f.calls, 'gate')

  // Seed stale unconsumed main-chat starts in CallingChats.
  f.calls.saw('b1', 'b1-main', 'mcp__lilbot_system__lilbot_computers_list', {}, 'stale-comp')
  f.calls.saw('b1', 'b1-main', 'mcp__lilbot_system__lilbot_memory_forget', { id: ownerFact.id.slice(0, 8) }, 'stale-forget')

  // Start an active review pass concurrently.
  const run = f.startReviewRun('b1')
  await reviewReq(f, `${SESSION_MCP_PATH}?run=${run.runId}`, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, { authorization: reviewKey('b1', run.runId) })

  // Review cannot borrow stale main-chat starts to run forbidden tools or delete owner facts.
  expect((await reviewCall(f, 'b1', run.runId, 'lilbot_computers_list', {})).error).toContain('not available in a memory review')
  expect((await reviewCall(f, 'b1', run.runId, 'lilbot_memory_forget', { id: ownerFact.id.slice(0, 8) })).error).toBe('The user wrote this fact. A review may not remove it.')
  expect(f.memory.list('b1').some(fact => fact.id === ownerFact.id)).toBe(true)

  // Ordinary main-chat save & forget with no tool.start while review runs: zero CallingChats.gate calls, zero refusal.
  const started = performance.now()
  const mainForget = await f.call('b1', 'lilbot_memory_forget', { id: mainFactToForget.id.slice(0, 8) }, false)
  expect(mainForget.error).toBeUndefined()
  expect(f.memory.list('b1').some(fact => fact.id === mainFactToForget.id)).toBe(false)
  for (let i = 0; i < 100; i++) {
    const saved = await f.call('b1', 'lilbot_memory_save', { kind: 'journal', text: `Main chat journal entry number ${i}.` }, false)
    expect(saved.error).toBeUndefined()
  }
  const elapsedMs = performance.now() - started
  expect(gateSpy).toHaveBeenCalledTimes(0)
  expect(elapsedMs).toBeLessThan(2000)
  expect(f.memory.list('b1').find(fact => fact.text === 'Main chat journal entry number 0.')?.via).toBe('chat')
  // Every write on /engine/lilbot/mcp is an ordinary chat write — never via:'review'.
  expect(f.memory.list('b1').filter(fact => fact.via === 'review')).toEqual([])

  run.finish()
})
