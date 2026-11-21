import { afterAll, expect, test } from 'bun:test'
import { delegationFixture, removeFixtureFolders } from './delegation-fixture'

afterAll(removeFixtureFolders)

type Marks = { botId: string; kind: string; working: boolean }[]
const watched = () => {
  const marks: Marks = []
  const pushes: boolean[] = []
  return {
    marks,
    pushes,
    options: {
      activity: (botId: string, d: { kind: string }, working: boolean) => marks.push({ botId, kind: d.kind, working }),
      touched: (roster?: boolean) => roster !== undefined && pushes.push(roster)
    }
  }
}
const runsOf = (f: ReturnType<typeof delegationFixture>, bot: string) => f.runs.filter(r => r.botId === bot)
const start = (f: ReturnType<typeof delegationFixture>) =>
  f.groups.act('a', { action: 'start', requestId: 'g', purpose: 'Pick a name', members: ['b', 'c'], text: 'One name each.' }) as Promise<any>

test('the roster carries a member’s live activity in its group, from the tool call seen in that turn, and drops it when the turn ends', async () => {
  const w = watched()
  const f = delegationFixture(w.options)
  await start(f)
  await f.settle()
  const groupOf = (bot: string) => f.threads.roster().get(bot)?.groups?.[0]
  expect(groupOf('b')).not.toHaveProperty('activity')
  f.threads.runner.sawTool(runsOf(f, 'b')[0].chatId, 'Running commands')
  expect(groupOf('b')).toMatchObject({ leading: false, activity: 'Running commands' })
  expect(groupOf('c')).not.toHaveProperty('activity')
  expect(groupOf('a')).not.toHaveProperty('activity')
  expect(w.pushes).toEqual([true])
  runsOf(f, 'b')[0].finish('Pelican')
  await f.settle()
  expect(groupOf('b')).not.toHaveProperty('activity')
})

test('the leader’s own turn on a round shows its activity too, and a tool call outside any group does not push the roster', async () => {
  const w = watched()
  const f = delegationFixture(w.options)
  await start(f)
  await f.settle()
  runsOf(f, 'b')[0].finish('Pelican')
  runsOf(f, 'c')[0].finish('Heron')
  await f.settle()
  await f.settle()
  f.threads.runner.sawTool(runsOf(f, 'a')[0].chatId, 'Searching the web')
  expect(f.threads.roster().get('a')?.groups?.[0]).toMatchObject({ leading: true, activity: 'Searching the web' })
  expect(w.pushes).toEqual([true])
  await f.delegation.delegate('d', { requestId: 'x', tasks: [{ to: 'c', task: 'Check the build' }] })
  await f.settle()
  f.threads.runner.sawTool(runsOf(f, 'c').at(-1)!.chatId, 'Running commands')
  expect(w.pushes).toEqual([true, false])
})

test('the leader is not shown working while its members take a point; it is again for its own turn on the replies', async () => {
  const w = watched()
  const f = delegationFixture(w.options)
  await start(f)
  await f.settle()
  expect(w.marks).toEqual([
    { botId: 'b', kind: 'point', working: true },
    { botId: 'c', kind: 'point', working: true }
  ])
  runsOf(f, 'b')[0].finish('Pelican')
  runsOf(f, 'c')[0].finish('Heron')
  await f.settle()
  await f.settle()
  expect(w.marks.filter(m => m.botId === 'a')).toEqual([{ botId: 'a', kind: 'round', working: true }])
  expect(w.marks.filter(m => m.kind === 'point' && !m.working).map(m => m.botId)).toEqual(['b', 'c'])
})

test('both bots of a handed-over task are still shown working while its receiver runs', async () => {
  const w = watched()
  const f = delegationFixture(w.options)
  await f.delegation.delegate('a', { requestId: 'r', tasks: [{ to: 'b', task: 'Check the build' }] })
  await f.settle()
  expect(w.marks.map(m => [m.botId, m.working])).toEqual([
    ['a', true],
    ['b', true]
  ])
})
