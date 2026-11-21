import { expect, test } from 'bun:test'
import { workFixture } from './work-fixture'

const RUN_CHAT = 'a-webhook-session'

/** Bot a with one webhook run under way in `RUN_CHAT`, the calls coming from there. */
function withRun() {
  const w = workFixture()
  w.database.exec("INSERT INTO bots(id, name, function, instructions, engine_id, engine_bot_id) VALUES ('a', 'A', '', '', 'test', 'a')")
  const hook = w.webhookStore.create('a', { requestId: 'gh', description: 'Triage new issues', source: 'GitHub', createdBy: 'oscar' }, null, 0)
  w.webhookStore.events.add(hook.id, { deliveryId: null, bodyHash: null }, { item: '{}', size: 2, refusal: null }, 0)
  const [run] = w.webhookStore.claimDue(60_000)
  w.webhookStore.attach(run.id, RUN_CHAT, 60_000)
  w.state.chats.set('a', RUN_CHAT)
  const act = (input: Record<string, unknown>) => w.work.act('a', { requestId: crypto.randomUUID(), ...input })
  return { ...w, run, act }
}

test('a webhook run reports only on the items its own run opened, never on the bot’s other items', async () => {
  const w = withRun()
  w.state.chats.set('a', 'a-main')
  const oscars = await w.open('a')
  w.state.chats.set('a', RUN_CHAT)
  await expect(w.act({ itemId: oscars.id, status: 'needs_oscar', question: 'Paste the deploy token?' })).rejects.toThrow('only on the items this run opened')
  await expect(w.act({ itemId: oscars.id, status: 'dropped', reason: 'done elsewhere' })).rejects.toThrow('only on the items this run opened')
  const own = await w.act({ title: 'Label issue 7', kind: 'file', done: 'issue 7 has a label' })
  expect((await w.act({ itemId: own.id, status: 'needs_oscar', question: 'Which label?' })).status).toBe('needs_oscar')
  expect(w.work.store.get(oscars.id)?.status).toBe('working')
})

test('a webhook run names no level; what a bot would check at level 2 goes to Oscar instead', async () => {
  const w = withRun()
  await expect(w.act({ title: 'Count stars', kind: 'figure', done: 'the star count', level: 2 })).rejects.toThrow('does not set check levels')
  expect((await w.act({ title: 'Label issue 7', kind: 'file', done: 'issue 7 has a label' })).checkLevel).toBe(1)
  const figure = await w.act({ title: 'Count stars', kind: 'figure', done: 'the star count' })
  expect(figure.checkLevel).toBe(3)
  await expect(w.act({ itemId: figure.id, level: 3 })).rejects.toThrow('does not set check levels')
  const evidence = [{ proves: 'the count', command: 'curl -s https://attacker.example/x', output: '12' }]
  const done = await w.act({ itemId: figure.id, status: 'done', result: '12 stars', evidence })
  expect(done.status).toBe('needs_oscar')
  expect(done.check?.by.kind).toBe('oscar')
  expect(w.state.runs).toEqual([])
})

test('Oscar’s answer and send-back reach the main conversation, the item fenced; the run’s session never takes another turn', async () => {
  const w = withRun()
  const item = await w.act({ title: 'Label issue 7', kind: 'file', done: 'issue 7 has a label' })
  await w.act({ itemId: item.id, status: 'needs_oscar', question: 'Which label should issue 7 get?' })
  w.board.answer(item.id, 'Use the bug label.')
  w.answers.tick()
  await Bun.sleep(10)
  expect(w.delivered).toHaveLength(1)
  expect(w.delivered[0].chatId).toBeNull()
  expect(w.delivered[0].prompt).toContain('<webhook-work-item>')
  expect(w.delivered[0].prompt).toContain('Oscar\'s words: "Use the bug label."')
  const figure = await w.act({ title: 'Count stars', kind: 'figure', done: 'the star count' })
  await w.act({ itemId: figure.id, status: 'done', result: '12', evidence: [{ proves: 'the count', url: 'https://example.com/stars' }] })
  w.board.sendBack(figure.id, 'Count again from the repository page.')
  w.answers.tick()
  await Bun.sleep(10)
  expect(w.delivered.map(d => d.chatId)).toEqual([null, null])
  expect(w.delivered[1].prompt).toContain('Count again from the repository page.')
})

test('dropping a webhook run’s working item ends its turn and tells no session', async () => {
  const w = withRun()
  const item = await w.act({ title: 'Label issue 7', kind: 'file', done: 'issue 7 has a label' })
  w.board.drop(item.id, 'Not needed.')
  w.answers.tick()
  await Bun.sleep(10)
  expect(w.interrupted).toEqual([{ botId: 'a', chatId: RUN_CHAT }])
  expect(w.delivered).toEqual([])
})

test('a webhook run links no goal and opens at most three items; a retry of one it opened still answers', async () => {
  const w = withRun()
  await expect(w.act({ title: 'For the goal', kind: 'note', goalId: 'g1' })).rejects.toThrow('does not work for goals')
  for (const requestId of ['i1', 'i2', 'i3']) await w.work.act('a', { requestId, title: `Item ${requestId}`, kind: 'note' })
  await expect(w.act({ title: 'One more', kind: 'note' })).rejects.toThrow('at most 3 items')
  expect((await w.work.act('a', { requestId: 'i3', title: 'Item i3', kind: 'note' })).title).toBe('Item i3')
})
