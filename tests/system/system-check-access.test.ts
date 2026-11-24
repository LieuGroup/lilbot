import { expect, test } from 'bun:test'
import { addBot, systemFixture } from './system-fixture'

const IN_CHECK = 'This session is a check'

/** Bot b1 checks an item in session `b1-check`. */
function checking() {
  const f = systemFixture()
  const check = f.work.work.checks.add('item-1', { kind: 'bot', id: 'b1', name: 'B1' }, null, null, Date.now())
  f.work.work.checks.attach(check.id, 'b1-check')
  return { f, check }
}

test('a check session only reads and gives its verdict: every change, and reading memory, is refused (#174)', async () => {
  const { f } = checking()
  f.from.set('b1', 'b1-check')
  expect((await f.call('b1', 'lilbot_about')).data).toBeDefined()
  expect((await f.call('b1', 'lilbot_section_create', { name: 'Checked' })).error).toContain(IN_CHECK)
  expect((await f.call('b1', 'lilbot_memory_list')).error).toContain(IN_CHECK)
  expect((await f.call('b1', 'lilbot_memory_recall', { query: 'x' })).error).toContain(IN_CHECK)
  expect((await f.call('b1', 'lilbot_memory_save', { text: 'Check should not save.' })).error).toContain(IN_CHECK)
  expect((await f.call('b1', 'lilbot_memory_forget', { id: 'abcd1234' })).error).toContain(IN_CHECK)
  expect((await f.call('b1', 'lilbot_history_search', { query: 'report' })).error).toContain(IN_CHECK)
  expect((await f.call('b1', 'lilbot_skill_read')).data.skills).toEqual([])
  expect((await f.call('b1', 'lilbot_skill_manage', { action: 'create', name: 'check-skill', content: '---\nname: check-skill\ndescription: Bad\n---\nNo.' })).error).toContain(
    IN_CHECK
  )
  expect((await f.call('b1', 'lilbot_give_file', { path: 'a.txt', title: 'A', requestId: 'r1' })).error).toContain(IN_CHECK)
  expect((await f.call('b1', 'lilbot_delegate', { requestId: 'r2', tasks: [{ to: 'b2', task: 'x' }] })).error).toContain(IN_CHECK)
  expect((await f.call('b1', 'lilbot_delegation', { action: 'status' })).data.exchanges).toEqual([])
  for (const args of [
    { action: 'cancel', exchangeId: 'e1' },
    { action: 'redirect', requestId: 'r4', exchangeId: 'e1', message: 'stop' },
    { action: 'wait', batchId: 'b' },
    { action: 'attach', exchangeId: 'e1', files: ['a.txt'] },
    {}
  ]) {
    expect((await f.call('b1', 'lilbot_delegation', args)).error).toContain(IN_CHECK)
  }
  expect((await f.call('b1', 'lilbot_webhook', { action: 'pause', id: 'h1' })).error).toContain(IN_CHECK)
  expect((await f.call('b1', 'lilbot_webhook_message', { requestId: 'm1', text: 'hi' })).error).toContain(IN_CHECK)
  expect((await f.call('b1', 'lilbot_group', { action: 'start', requestId: 'r3', purpose: 'x', text: 'y', members: ['b2', 'b3'] })).error).toContain(IN_CHECK)
  expect((await f.call('b1', 'lilbot_group', { action: 'status', groupId: 'nope' })).error).not.toContain(IN_CHECK)
  // The verdict passes the gate; the board decides on it (here: no such item is being checked).
  expect((await f.call('b1', 'lilbot_work', { requestId: 'v', itemId: 'item-1', verdict: 'verified', result: 'Seen' })).error).not.toContain(IN_CHECK)
  expect(f.changes.recent(5)).toEqual([])
})

test('while a bot checks, its other sessions keep working, and a call no session reported is refused; once the check ends nothing is held', async () => {
  const { f, check } = checking()
  expect((await f.call('b1', 'lilbot_section_create', { name: 'From Oscar' })).data).toBeDefined()
  expect((await f.call('b1', 'lilbot_memory_recall', { query: 'x' })).data.facts).toEqual([])
  expect((await f.call('b1', 'lilbot_history_search', { query: 'report' })).data).toEqual({ matches: [], import: { sessions: 0, completed: 0, items: 0, complete: false } })
  expect((await f.call('b1', 'lilbot_history_search', { query: 'report' }, false)).error).toContain('Make the same call again')
  expect((await f.call('b1', 'lilbot_section_create', { name: 'Unseen' }, false)).error).toContain('Make the same call again')
  expect((await f.call('b1', 'lilbot_memory_recall', { query: 'x' }, false)).error).toContain('Make the same call again')
  const other = await addBot(f, 'Other')
  expect((await f.call(other.id, 'lilbot_section_create', { name: 'Not held' }, false)).data).toBeDefined()
  expect((await f.call(other.id, 'lilbot_history_search', { query: 'report' }, false)).data.matches).toEqual([])
  f.work.work.checks.settle(check.id, 'verified', 'seen', null, Date.now())
  expect((await f.call('b1', 'lilbot_section_create', { name: 'After' }, false)).data).toBeDefined()
  expect((await f.call('b1', 'lilbot_history_search', { query: 'report' }, false)).data.matches).toEqual([])
})
