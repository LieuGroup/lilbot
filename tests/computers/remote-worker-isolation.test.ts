/** Cross-bot and shared-state isolation matrix for every allow-listed remote worker MCP tool.
 *  Proves a worker of Bot A cannot read or mutate anything belonging to Bot B or shared across all bots across every argument and default. */
import { expect, test } from 'bun:test'
import { MAX_MEMORY_SAVES_PER_RUN, REMOTE_WORKER_TOOLS } from '../../server/system/worker-mcp'
import { addBot, systemFixture } from '../system/system-fixture'

const makeCtx = (botId: string, threadId: string, runId = `run-${threadId}`) => ({
  botId,
  threadId,
  chatId: `remote:${threadId}`,
  runId,
  computerId: 'remote-box'
})

async function callTool(f: ReturnType<typeof systemFixture>, ctx: ReturnType<typeof makeCtx>, name: string, args: Record<string, unknown> = {}) {
  const res = await f.workerMcp(ctx, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }))
  const json = JSON.parse(res.body)
  const text: string = json.result.content[0].text
  return json.result.isError ? { error: text } : { data: JSON.parse(text) }
}

test('isolation matrix: Bot A remote worker cannot read or change Bot B or shared state across all 6 allow-listed tools', async () => {
  const f = systemFixture()
  const botB = await addBot(f, 'Bot B')
  expect([...REMOTE_WORKER_TOOLS]).toEqual(['lilbot_work', 'lilbot_work_list', 'lilbot_memory_list', 'lilbot_memory_save', 'lilbot_skill_read', 'lilbot_guide'])

  // Seed Bot B private memory (kept and forgotten), Bot B work item, Bot A parent item with Bot B child, and per-bot skills.
  f.memory.write({ botId: botB.id, kind: 'profile', scope: 'bot', text: 'BOT_B_PRIVATE_FACT', author: 'bot' })
  const bForgotten = f.memory.write({ botId: botB.id, kind: 'journal', scope: 'bot', text: 'BOT_B_FORGOTTEN_FACT', author: 'bot' })
  f.memory.forgetAsUser(bForgotten.id)

  const workerId = 'w-iso-1'
  f.threads.store.save({
    id: workerId,
    participants: [
      { id: 'b1', name: 'Bot One' },
      { id: 'b1', name: 'Bot One' }
    ],
    createdAt: Date.now(),
    depth: 1,
    state: 'open',
    messages: [],
    batchId: null,
    parentId: null,
    status: 'working',
    activity: null,
    startedAt: Date.now(),
    endedAt: null,
    stoppedBy: null,
    worker: true
  })
  f.database.query('INSERT INTO thread_chats(chat_id, bot_id, thread_id) VALUES(?,?,?)').run(`remote:${workerId}`, 'b1', workerId)
  f.work.links.workerChild(null, { id: workerId, owner: { id: 'b1', name: 'Bot One' }, task: 'Bot A worker task' })

  const parentA = await f.work.work.actFrom('b1', { requestId: 'p-a', title: 'Bot A parent', kind: 'code' }, 'b1-main')
  f.work.links.child(parentA.id, { id: 'child-b', owner: { id: botB.id, name: 'Bot B' }, asker: { id: 'b1', name: 'Bot One' }, task: 'BOT_B_SECRET_CHILD' })
  const itemB = await f.work.work.actFrom(botB.id, { requestId: 'i-b', title: 'BOT_B_WORK_ITEM', kind: 'code' }, `${botB.id}-main`)

  f.skills.provide('bot-b-only', { 'SKILL.md': '---\nname: bot-b-only\ndescription: Secret B skill.\n---\nBOT_B_SKILL_BODY' })
  f.skills.setEnabled('b1', 'bot-b-only', false)

  const ctx = makeCtx('b1', workerId)

  // 1. lilbot_memory_save: default kind='profile' (no scope) MUST save as scope='bot', NEVER shared; explicit shared refused; cap enforced.
  const defaultSave = await callTool(f, ctx, 'lilbot_memory_save', { text: 'BOT_A_DEFAULT_PROFILE_FACT' })
  expect(defaultSave.data).toMatchObject({ scope: 'bot', text: 'BOT_A_DEFAULT_PROFILE_FACT' })
  expect(f.memory.contextBlock(botB.id).text).not.toContain('BOT_A_DEFAULT_PROFILE_FACT')
  expect(JSON.stringify(f.memory.panel(botB.id))).not.toContain('BOT_A_DEFAULT_PROFILE_FACT')
  expect(f.memory.contextBlock('b1').text).toContain('BOT_A_DEFAULT_PROFILE_FACT')

  const journalSave = await callTool(f, ctx, 'lilbot_memory_save', { kind: 'journal', text: 'BOT_A_JOURNAL_FACT' })
  expect(journalSave.data).toMatchObject({ scope: 'bot' })
  expect(f.memory.contextBlock(botB.id).text).not.toContain('BOT_A_JOURNAL_FACT')

  expect((await callTool(f, ctx, 'lilbot_memory_save', { kind: 'profile', scope: 'shared', text: 'POISON_SHARED' })).error).toContain('bot-private')
  expect(f.memory.contextBlock(botB.id).text).not.toContain('POISON_SHARED')

  // Per-run cap (already saved 2 above; next 8 succeed, 11th refused; another runId has a fresh cap).
  for (let i = 2; i < MAX_MEMORY_SAVES_PER_RUN; i++) {
    expect((await callTool(f, ctx, 'lilbot_memory_save', { text: `Worker fact number ${i}.` })).data).toBeDefined()
  }
  expect((await callTool(f, ctx, 'lilbot_memory_save', { text: 'Overflow worker fact.' })).error).toContain('limit')
  expect((await callTool(f, makeCtx('b1', workerId, 'run-other'), 'lilbot_memory_save', { text: 'Fresh run fact.' })).data.scope).toBe('bot')

  // 2. lilbot_memory_list: default and botId=botB cannot leak Bot B's private kept or forgotten facts.
  const memList = await callTool(f, ctx, 'lilbot_memory_list', {})
  expect(JSON.stringify(memList.data)).not.toContain('BOT_B_PRIVATE_FACT')
  expect(JSON.stringify(memList.data)).not.toContain('BOT_B_FORGOTTEN_FACT')
  expect((await callTool(f, ctx, 'lilbot_memory_list', { botId: botB.id })).error).toContain('only read')

  // 3. lilbot_work: cannot touch Bot B's item, cannot touch Bot A's other item, cannot open new item, cannot submit verdict.
  expect((await callTool(f, ctx, 'lilbot_work', { requestId: 'x1', itemId: itemB.id, done: 'hijack' })).error).toContain(workerId)
  expect((await callTool(f, ctx, 'lilbot_work', { requestId: 'x2', itemId: parentA.id, done: 'hijack' })).error).toContain(workerId)
  expect((await callTool(f, ctx, 'lilbot_work', { requestId: 'x3', title: 'new', kind: 'code' })).error).toContain(workerId)
  expect((await callTool(f, ctx, 'lilbot_work', { requestId: 'x4', itemId: workerId, verdict: 'verified' })).error).toContain('verdict')
  expect((await callTool(f, ctx, 'lilbot_work', { requestId: 'x5', itemId: workerId, done: 'Done check', status: 'working' })).data.id).toBe(workerId)

  // 4. lilbot_work_list: refuses mine:false, goals (true or false), goalId, Bot B itemId, and strips Bot B children from Bot A parent view.
  expect(JSON.stringify((await callTool(f, ctx, 'lilbot_work_list', {})).data)).not.toContain('BOT_B_WORK_ITEM')
  expect((await callTool(f, ctx, 'lilbot_work_list', { mine: false })).error).toContain('only read')
  expect((await callTool(f, ctx, 'lilbot_work_list', { goals: true })).error).toContain('only read')
  expect((await callTool(f, ctx, 'lilbot_work_list', { goals: false })).error).toContain('only read')
  expect((await callTool(f, ctx, 'lilbot_work_list', { goalId: 'g1' })).error).toContain('only read')
  expect((await callTool(f, ctx, 'lilbot_work_list', { itemId: itemB.id })).error).toContain('only read')
  const parentView = await callTool(f, ctx, 'lilbot_work_list', { itemId: parentA.id })
  expect(JSON.stringify(parentView.data)).not.toContain('BOT_B_SECRET_CHILD')

  // 5. lilbot_skill_read: omits skills disabled for Bot A even when enabled for Bot B; refuses direct read and traversal.
  const skillList = await callTool(f, ctx, 'lilbot_skill_read', {})
  expect(JSON.stringify(skillList.data)).not.toContain('bot-b-only')
  expect((await callTool(f, ctx, 'lilbot_skill_read', { name: 'bot-b-only' })).error).toContain('disabled or missing')
  expect((await callTool(f, ctx, 'lilbot_skill_read', { name: 'lilbot-work', filePath: '../secret' })).error).toBeDefined()

  // 6. lilbot_guide: static read-only guide topics only.
  expect((await callTool(f, ctx, 'lilbot_guide', {})).data.topics.some((t: string) => t.startsWith('threads:'))).toBe(true)
})
