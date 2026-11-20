import { afterAll, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { delegationFixture, removeFixtureFolders } from './delegation-fixture'

afterAll(removeFixtureFolders)

type Fixture = ReturnType<typeof delegationFixture>
const start = (f: Fixture, extra: Record<string, unknown> = {}) =>
  f.groups.act('a', { action: 'start', requestId: 'g1', purpose: 'Pick a name', members: ['b', 'C'], text: 'Suggest one name each.', ...extra }) as Promise<any>
const runsOf = (f: Fixture, bot: string) => f.runs.filter(r => r.botId === bot)

/** A group whose first round is in: B said Pelican, C said Heron, and the leader's turn on it is running. */
async function roundOneIn(f: Fixture) {
  const { groupId } = await start(f)
  await f.settle()
  runsOf(f, 'b')[0].finish('Name: Pelican')
  runsOf(f, 'c')[0].finish('Name: Heron')
  await f.settle()
  await f.settle()
  return groupId as string
}

test('members reply to a point in parallel, each in its own hidden session, and the round reaches the leader once', async () => {
  const f = delegationFixture()
  const started = await start(f)
  expect(started).toMatchObject({ purpose: 'Pick a name', leader: 'A', round: 1, roundCap: 6, state: 'running' })
  expect((await start(f)).groupId).toBe(started.groupId)
  await f.settle()
  expect(f.runs.map(r => r.botId)).toEqual(['b', 'c'])
  expect(f.runs[0].prompt).toContain('"Pick a name"')
  expect(f.runs[0].prompt).toContain('"Suggest one name each."')
  expect(f.runs[0].prompt).toContain('for everyone')
  expect(f.store.isInternal(f.runs[0].chatId)).toBe(true)
  expect(f.threads.roster().get('b')).toEqual([{ id: started.groupId, purpose: 'Pick a name', round: 1, roundCap: 6, leading: false }])
  expect(f.threads.roster().get('a')?.[0].leading).toBe(true)
  expect((await f.threads.open('a', started.groupId)).group!.members!.map(m => m.state)).toEqual(['idle', 'working', 'working'])

  f.runs[0].finish('Name: Pelican')
  await f.settle()
  const half = (await f.threads.open('c', started.groupId)).group!
  expect(half.members!.map(m => m.state)).toEqual(['idle', 'replied', 'working'])
  expect(half.rounds[0].replied).toEqual(['b'])
  expect(runsOf(f, 'a')).toHaveLength(0)
  await expect(f.groups.act('a', { action: 'say', groupId: started.groupId, requestId: 's', text: 'Too soon' })).rejects.toThrow('under way')

  f.runs[1].finish('Name: Heron')
  await f.settle()
  await f.settle()
  const [leader] = runsOf(f, 'a')
  expect(runsOf(f, 'a')).toHaveLength(1)
  expect(leader.prompt).toContain('round 1 of 6 are in')
  expect(leader.prompt).toContain('"Your first point was: "Suggest one name each."'.slice(1))
  expect(leader.prompt).toContain('"B": <bot-message>\n"Name: Pelican"\n</bot-message>')
  expect(leader.prompt).toContain('"C": <bot-message>\n"Name: Heron"\n</bot-message>')
  expect(f.store.isInternal(leader.chatId)).toBe(true)
  const view = await f.threads.open('a', started.groupId)
  expect(view.group!.turns).toBe(2)
  expect(view.messages.map(m => [m.authorId, m.round ?? null])).toEqual([
    ['a', 1],
    ['b', null],
    ['c', null]
  ])
})

test('the next point goes to one member in its own session and carries only what is new to it', async () => {
  const f = delegationFixture()
  const groupId = await roundOneIn(f)
  const said = await f.groups.act('a', { action: 'say', groupId, requestId: 's2', text: 'C, compare both names.', to: ['C'] })
  expect(said).toMatchObject({ round: 2 })
  await f.groups.act('a', { action: 'say', groupId, requestId: 's2', text: 'C, compare both names.', to: ['C'] })
  await f.settle()
  const [first, second] = runsOf(f, 'c')
  expect(runsOf(f, 'b')).toHaveLength(1)
  expect(second.options.chatId).toBe(first.chatId)
  expect(second.prompt).toContain('for you only')
  expect(second.prompt).toContain('Name: Pelican')
  expect(second.prompt).not.toContain('Name: Heron')
  expect(second.prompt).not.toContain('Suggest one name each.')
  await expect(f.groups.act('b', { action: 'say', groupId, requestId: 'x', text: 'Me too' })).rejects.toThrow('Only the leader')
  await expect(f.groups.act('d', { action: 'status', groupId })).rejects.toThrow('not in that group')
})

test('a member attaches a file to its reply; the copy lands in the group folder and the leader keeps it on close', async () => {
  const f = delegationFixture()
  const groupId = await roundOneIn(f)
  await f.groups.act('a', { action: 'say', groupId, requestId: 's2', text: 'C, write notes.md.', to: ['C'] })
  await f.settle()
  await expect(f.groups.act('b', { action: 'attach', groupId, files: ['x.md'] })).rejects.toThrow('while you work')
  mkdirSync(f.path('c', ''), { recursive: true })
  writeFileSync(f.path('c', 'notes.md'), 'Pelican wins.\n')
  expect(await f.groups.act('c', { action: 'attach', groupId, files: ['notes.md'] })).toMatchObject({ files: ['notes.md'] })
  runsOf(f, 'a')[0].finish('Asked C.')
  runsOf(f, 'c')[1].finish('Notes attached.')
  await f.settle()
  await f.settle()
  const shared = (await f.threads.open('a', groupId)).messages.at(-1)!.files![0]
  expect(shared).toMatchObject({ name: 'notes.md', fromId: 'c' })
  expect(readFileSync(join(f.root, '.groups', groupId, shared.path!), 'utf8')).toBe('Pelican wins.\n')
  expect(runsOf(f, 'a')[1].prompt).toContain(join(f.root, '.groups', groupId, shared.path!))

  const closed = (await f.groups.act('a', { action: 'close', groupId, requestId: 'c', text: 'We pick Pelican.', keep: ['notes.md'] })) as any
  const [kept] = closed.kept as string[]
  expect(closed.state).toBe('closed')
  expect(kept).toMatch(new RegExp(`^groups/${groupId}/[0-9a-f]{8}-notes\\.md$`))
  expect(f.group.given).toEqual([{ botId: 'a', path: kept, title: 'notes.md', chatId: 'a-main' }])
  expect(readFileSync(f.path('a', kept), 'utf8')).toBe('Pelican wins.\n')
  expect(f.stops).toEqual([])
  expect(existsSync(join(f.root, '.groups', groupId))).toBe(false)
  expect(existsSync(join(f.root, '.archive', '.groups', groupId, shared.path!))).toBe(true)
  await expect(f.groups.act('a', { action: 'say', groupId, requestId: 's3', text: 'More?' })).rejects.toThrow('ended')
})

test('the leader’s tool lines join the point it made in that turn', async () => {
  const f = delegationFixture()
  const groupId = await roundOneIn(f)
  await f.groups.act('a', { action: 'say', groupId, requestId: 's2', text: 'Round two.' })
  runsOf(f, 'a')[0].finish('Asked.', [{ kind: 'tool', toolId: 't1', name: 'terminal', detail: 'ls', running: false }])
  await f.settle()
  const point = (await f.threads.open('a', groupId)).messages.find(m => m.round === 2)!
  expect(point.items.map(i => i.kind)).toEqual(['tool', 'assistant'])
})

test('a member’s own delegation comes back into its group session and joins the discussion, sent nowhere else', async () => {
  const f = delegationFixture()
  const { groupId } = await start(f)
  await f.settle()
  const bRun = runsOf(f, 'b')[0]
  f.group.chats.set('b', bRun.chatId)
  await expect(f.groups.act('b', { action: 'start', requestId: 'n', purpose: 'Nested', members: ['c', 'd'], text: 'Hi' })).rejects.toThrow('No group inside a group')
  const handed = await f.delegation.delegate('b', { requestId: 'd1', tasks: [{ to: 'd', task: 'Look it up.' }] })
  bRun.finish('Asked D; more soon.')
  await f.settle()
  runsOf(f, 'd')[0].finish('D found Osprey.')
  await f.settle()
  await f.settle()
  const back = runsOf(f, 'b')[1]
  expect(back.options.chatId).toBe(bRun.chatId)
  back.finish('D says Osprey.')
  await f.settle()
  const view = await f.threads.open('a', groupId)
  expect(view.messages.filter(m => m.authorId === 'b').map(m => m.items.at(-1))).toEqual([
    { kind: 'assistant', text: 'Asked D; more soon.' },
    { kind: 'assistant', text: 'D says Osprey.' }
  ])
  expect(f.store.pending().filter(d => d.target === 'a')).toEqual([])
  expect((await f.threads.open('b', handed.exchanges[0].exchangeId)).status).toBe('finished')
})

test('two-party tools refuse a group', async () => {
  const f = delegationFixture()
  const { groupId } = await start(f)
  await f.settle()
  await expect(f.delegation.delegate('a', { requestId: 'x', tasks: [{ exchangeId: groupId, task: 'Hi' }] })).rejects.toThrow('group')
  await expect(f.delegation.cancel('a', groupId)).rejects.toThrow('group')
  await expect(f.delegation.attach('b', { exchangeId: groupId, files: ['x'] })).rejects.toThrow('group')
  await expect(f.delegation.redirect('a', { requestId: 'r', exchangeId: groupId, message: 'Hi' })).rejects.toThrow('group')
  expect((await f.delegation.status('a', {})).exchanges).toEqual([])
  await expect(f.threads.cancel(groupId, { kind: 'bot', id: 'a', name: 'A' })).rejects.toThrow('group')
  await expect(start(f, { requestId: 'g2', members: ['b', 'a'] })).rejects.toThrow('You lead the group')
  await expect(start(f, { requestId: 'g3', members: ['b', 'b'] })).rejects.toThrow('different bots')
})
