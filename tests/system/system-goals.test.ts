import { expect, test } from 'bun:test'
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

test("a goal is proposed only from the session that made the call: a routine run's earlier start with the same request id is not taken, and a call nothing reported is refused (#174)", async () => {
  const f = systemFixture()
  f.routineStore.create('b1', { requestId: 'daily', description: 'Check sales', schedule: { kind: 'interval', seconds: 600 }, createdBy: 'oscar' }, 0, 5)
  const [run] = f.routineStore.claimDue(Date.now() + 1_000_000)
  f.routineStore.attach(run.id, 'run-session', Date.now())
  const propose = { action: 'propose', requestId: 'g1', text: 'Grow notes.txt', agreement, target }
  f.from.set('b1', 'run-session')
  expect((await f.call('b1', 'lilbot_goal', propose)).error).toContain("A goal is Oscar's")
  f.from.delete('b1')
  const late = f.call('b1', 'lilbot_goal', propose, false)
  setTimeout(() => f.calls.saw('b1', 'b1-main', 'mcp__lilbot_system__lilbot_goal', propose, 'late'), 50)
  expect((await late).data).toMatchObject({ botId: 'b1', state: 'proposed' })
  expect((await f.call('b1', 'lilbot_goal', { ...propose, requestId: 'g2' }, false)).error).toContain('Make the same call again')
  expect((await f.call('b1', 'lilbot_work_list', { goals: true })).data.goals).toHaveLength(1)
})
