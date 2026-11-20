import { afterAll, expect, test } from 'bun:test'
import { GROUP_LIMITS } from '../../server/threads/thread-limits'
import { delegationFixture, removeFixtureFolders } from './delegation-fixture'

afterAll(removeFixtureFolders)

type Fixture = ReturnType<typeof delegationFixture>
const OSCAR = { kind: 'oscar', id: null, name: 'Oscar' } as const
const runsOf = (f: Fixture, bot: string) => f.runs.filter(r => r.botId === bot)
async function started(f: Fixture) {
  const { groupId } = (await f.groups.act('a', { action: 'start', requestId: 'g', purpose: 'Plan the trip', members: ['b', 'c'], text: 'Where to?' })) as any
  await f.settle()
  return groupId as string
}
async function replies(f: Fixture, b = 'Hobart', c = 'Darwin') {
  runsOf(f, 'b').at(-1)!.finish(b)
  runsOf(f, 'c').at(-1)!.finish(c)
  await f.settle()
  await f.settle()
}

test('closing delivers the outcome once into the leader’s own conversation and gives each member a private journal entry', async () => {
  const f = delegationFixture({ refuse: text => text.includes('Darwin') })
  const groupId = await started(f)
  await replies(f)
  await f.groups.act('a', { action: 'close', groupId, requestId: 'c', text: 'We go to Hobart.' })
  await f.groups.act('a', { action: 'close', groupId, requestId: 'c', text: 'We go to Hobart.' })
  runsOf(f, 'a')[0].finish('Closed it.')
  await f.settle()
  await f.settle()
  const outcome = runsOf(f, 'a').filter(r => r.options.chatId === 'a-main')
  expect(outcome).toHaveLength(1)
  expect(outcome[0].options.runId).toBe(`thread-group:${groupId}:end`)
  expect(outcome[0].prompt).toContain('<group-outcome>\n"We go to Hobart."\n</group-outcome>')
  expect(outcome[0].prompt).toContain('1 rounds, 3 turns')
  expect(f.group.journal.map(j => j.botId)).toEqual(['b', 'c'])
  expect(f.group.journal[0].text).toMatch(
    /^Took part in a temporary group led by A \(\d{4}-\d\d-\d\d\) for: Plan the trip\. It closed with an outcome\. Outcome: We go to Hobart\. My part: Hobart$/
  )
  // Memory refused C's entry with its own words in it; the one without them is saved instead.
  expect(f.group.journal[1].text).not.toContain('My part')
  expect(f.group.journal[1].chatId).toBe(runsOf(f, 'c')[0].chatId)
  const view = await f.threads.open('b', groupId)
  expect(view).toMatchObject({ status: 'finished', group: { end: { how: 'closed', outcome: 'We go to Hobart.' } } })
  expect(view.messages.at(-1)).toMatchObject({ authorId: 'a', items: [{ kind: 'assistant', text: 'Closed it.' }] })
  expect(f.threads.roster().size).toBe(0)
})

test('Oscar stops a group: every turn stops, nothing more runs, the leader is told and late words are kept as withheld', async () => {
  const f = delegationFixture()
  const groupId = await started(f)
  const stopped = await f.threads.cancel(groupId, OSCAR)
  expect(stopped).toMatchObject({ status: 'cancelled', stoppedBy: { kind: 'oscar' }, group: { end: { how: 'stopped', outcome: 'Stopped by Oscar in round 1.' } } })
  expect(f.stops.sort()).toEqual([runsOf(f, 'b')[0].chatId, runsOf(f, 'c')[0].chatId].sort())
  expect((await f.threads.cancel(groupId, OSCAR)).group!.end!.at).toBe(stopped.group!.end!.at)
  await replies(f, 'Too late', 'Also late')
  await f.settle()
  const view = await f.threads.open('a', groupId)
  expect(view.messages.slice(1).every(m => m.withheld)).toBe(true)
  expect(view.group!.turns).toBe(0)
  const told = runsOf(f, 'a')
  expect(told.map(r => r.options.chatId)).toEqual(['a-main'])
  expect(told[0].prompt).toContain('was stopped by Oscar in round 1')
  expect(f.group.journal).toHaveLength(2)
})

test('a group ends by itself at its round limit; the last replies reach the leader’s conversation with the reason', async () => {
  const f = delegationFixture({ limits: { ...GROUP_LIMITS, rounds: 2 } })
  const groupId = await started(f)
  await replies(f)
  expect(runsOf(f, 'a')[0].prompt).toContain('Round 2 is the last')
  await f.groups.act('a', { action: 'say', groupId, requestId: 's2', text: 'B, how long?', to: ['b'] })
  runsOf(f, 'a')[0].finish('Asked B.')
  await f.settle()
  runsOf(f, 'b')[1].finish('Five days.')
  await f.settle()
  await f.settle()
  const view = await f.threads.open('a', groupId)
  expect(view.group).toMatchObject({ roundCap: 2, turns: 4, end: { how: 'rounds', outcome: 'Ended by itself at the round limit (2 rounds).' } })
  const [, told] = runsOf(f, 'a')
  expect(runsOf(f, 'a')).toHaveLength(2)
  expect(told.options.chatId).toBe('a-main')
  expect(told.prompt).toContain('ended by itself: Ended by itself at the round limit (2 rounds).')
  expect(told.prompt).toContain('"Five days."')
  expect(f.store.delivery(`group:${groupId}:2:leader`)).toBeNull()
})

test('the message limit refuses a point that does not fit and ends a group with no room for another round', async () => {
  const f = delegationFixture({ limits: { ...GROUP_LIMITS, messages: 5 } })
  const groupId = await started(f)
  await replies(f)
  await expect(f.groups.act('a', { action: 'say', groupId, requestId: 's2', text: 'Both again', to: ['b', 'c'] })).rejects.toThrow('Only 2 more messages')
  await f.groups.act('a', { action: 'say', groupId, requestId: 's3', text: 'B only', to: ['b'] })
  await f.settle()
  runsOf(f, 'b')[1].finish('OK')
  await f.settle()
  expect((await f.threads.open('a', groupId)).group!.end!.how).toBe('messages')
})

test('a group goes quiet when its leader does nothing after a round, and ends at its time limit while members work', async () => {
  const f = delegationFixture()
  const quiet = await started(f)
  await replies(f)
  f.groups.ending.tick(Date.now() + 10 * 60_000)
  expect((await f.threads.open('a', quiet)).group!.end).toBeNull()
  runsOf(f, 'a')[0].finish('Thinking about it.')
  await f.settle()
  f.groups.ending.tick(Date.now() + 16 * 60_000)
  expect((await f.threads.open('a', quiet)).group!.end!.how).toBe('quiet')

  const g = delegationFixture()
  const slow = await started(g)
  g.groups.ending.tick(Date.now() + 121 * 60_000)
  await Bun.sleep(20)
  expect((await g.threads.open('a', slow)).group!.end!.how).toBe('time')
  expect(g.stops).toHaveLength(2)
})

test('a deleted member counts as a failed reply; an outcome that cannot reach a deleted leader is dropped, the end unchanged', async () => {
  const f = delegationFixture()
  const { groupId } = (await f.groups.act('a', { action: 'start', requestId: 'g', purpose: 'Plan the trip', members: ['b', 'c'], text: 'Where to?' })) as any
  f.remove('c')
  await f.settle()
  runsOf(f, 'b')[0].finish('Hobart')
  await f.settle()
  await f.settle()
  const view = await f.threads.open('a', groupId)
  expect(view.messages.find(m => m.authorId === 'c')!.items).toEqual([{ kind: 'error', text: 'LilBot could not hand this point over: the bot is missing.' }])
  expect(runsOf(f, 'a')[0].prompt).toContain('could not hand this point over')
  f.remove('a')
  runsOf(f, 'a')[0].finish('Too late')
  await f.groups.act('b', { action: 'status', groupId })
  await f.threads.cancel(groupId, OSCAR)
  await f.settle()
  await f.settle()
  expect((await f.threads.open('b', groupId)).status).toBe('cancelled')
  expect(f.store.delivery(`group:${groupId}:end`)?.status).toBe('done')
})
