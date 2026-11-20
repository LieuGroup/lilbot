import { expect, test } from 'bun:test'
import { CallingChats } from '../../server/threads/calling-chats'
import { addBot, systemFixture } from './system-fixture'

const target = {
  measure: 'lines in notes.txt',
  source: 'notes.txt',
  baseline: 3,
  evidence: { proves: 'count', command: 'wc -l notes.txt', output: '3 notes.txt' },
  value: 10,
  due: '2099-01-01'
}
const agreement = { alone: ['Write lines'], needsOscar: [], cannotInfluence: ['What he likes'] }

test('a bot proposes a goal with its own key and reads it with lilbot_work_list; the change log names the goal, reads leave nothing', async () => {
  const f = systemFixture()
  const proposed = await f.call('b1', 'lilbot_goal', { action: 'propose', requestId: 'g1', text: 'Grow notes.txt', agreement, target, botId: 'someone-else' })
  expect(proposed.data).toMatchObject({ botId: 'b1', state: 'proposed', target: { baseline: { value: 3 } } })
  const id = proposed.data.id
  const [change] = f.changes.recent(5)
  expect(change).toMatchObject({ botId: 'b1', tool: 'lilbot_goal', target: id })
  expect(change.fields).toContain('target')
  const other = await addBot(f, 'Other')
  expect((await f.call(other.id, 'lilbot_work_list', { goals: true })).data.goals).toEqual([])
  expect((await f.call(other.id, 'lilbot_work_list', { goals: true, mine: false })).data.goals.map((g: { id: string }) => g.id)).toEqual([id])
  expect((await f.call(other.id, 'lilbot_work_list', { goalId: id })).data).toMatchObject({ id, reviews: [], items: [], events: [{ kind: 'proposed' }] })
  expect((await f.call(other.id, 'lilbot_work_list')).data.items).toEqual([])
  expect(f.changes.recent(5)).toHaveLength(1)
  expect((await f.call('b1', 'lilbot_goal', { action: 'progress', requestId: 'p1', goalId: id, value: 4, did: 'x', evidence: [target.evidence] })).error).toContain('not agreed')
  expect((await f.call(other.id, 'lilbot_work', { requestId: 'w', title: 'Help', kind: 'note', goalId: id })).error).toContain('No goal of yours')
})

test("a goal call is traced to the session that made it, so a review is credited to its routine run and a goal to Oscar's conversation", async () => {
  const calls = new CallingChats(() => 'main', 0)
  calls.saw('a', 'routine-run-session', 'mcp__lilbot_system__lilbot_goal', { requestId: 'review-1' })
  calls.saw('a', 'hidden', 'tool_call', { name: 'mcp__lilbot_system__lilbot_goal', arguments: '{"requestId":"review-2"}' })
  expect(await calls.find('a', 'review-1')).toBe('routine-run-session')
  expect(await calls.find('a', 'review-2')).toBe('hidden')
  expect(await calls.find('a', 'unknown')).toBe('main')
})
