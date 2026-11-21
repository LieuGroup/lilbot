import { expect, test } from 'bun:test'
import type { BotThread, ThreadGroup, ThreadMessage } from '../../shared/thread-schema'
import {
  groupActivityRow,
  groupState,
  groupSubtitle,
  groupTitle,
  outcomeCard,
  pendingReplies,
  roundLabel,
  runningGroups,
  shortNames,
  stopSentence
} from '../../web/src/threads/group-lines'
import { activityOrder, running } from '../../web/src/threads/thread-lines'
import { testBot } from './test-bot'

const MIN = 60_000
const T0 = new Date(2026, 10, 21, 10, 10).getTime()
const lead = { id: 'lead', name: 'FillLight Bot' }
const footy = { id: 'footy', name: 'Footy President Bot' }
const heard = { id: 'heard', name: 'HeardBack Bot' }
const eng = { id: 'eng', name: 'Server Engineer' }

const point = (n: number, at: number): ThreadMessage => ({ id: `p${n}`, authorId: 'lead', authorName: lead.name, createdAt: at, items: [], round: n })

function group(extra: Partial<ThreadGroup> = {}, thread: Partial<BotThread> = {}) {
  const g: ThreadGroup = {
    purpose: 'Agree the 1.2 launch plan',
    roundCap: 6,
    rounds: [
      { n: 1, to: ['footy', 'heard', 'eng'], at: T0, requestId: 'r1', replied: ['footy', 'heard', 'eng'] },
      { n: 2, to: ['footy', 'heard'], at: T0 + 4 * MIN, requestId: 'r2', replied: ['footy'] }
    ],
    turns: 6,
    lastAt: T0 + 5 * MIN,
    end: null,
    kept: [],
    folder: '/w/.groups/g1',
    seen: {},
    members: [
      { id: 'lead', state: 'idle', activity: null },
      { id: 'footy', state: 'replied', activity: null },
      { id: 'heard', state: 'working', activity: 'Searching the web' },
      { id: 'eng', state: 'idle', activity: null }
    ],
    ...extra
  }
  return {
    id: 'g1',
    participants: [lead, footy, heard, eng],
    createdAt: T0,
    depth: 0,
    state: 'open',
    messages: [point(1, T0), point(2, T0 + 4 * MIN)],
    batchId: null,
    parentId: null,
    status: 'working',
    activity: null,
    startedAt: T0,
    endedAt: null,
    stoppedBy: null,
    group: g,
    ...thread
  } satisfies BotThread
}

const now = T0 + 11 * MIN
const ended = (how: NonNullable<ThreadGroup['end']>['how'], outcome = '') =>
  group({ roundCap: how === 'rounds' ? 2 : 6, end: { how, at: now, outcome } }, { endedAt: now, status: how === 'stopped' ? 'cancelled' : 'finished' })

test('the line names the group for the leader and a member, and counts replies while a round runs', () => {
  expect(groupTitle(group(), 'lead')).toBe('Group · Agree the 1.2 launch plan')
  expect(groupTitle(group(), 'heard')).toBe("In FillLight Bot's group · Agree the 1.2 launch plan")
  expect(groupState(group(), now)).toEqual({ icon: 'working', text: 'Round 2 · 1 of 2 have replied', failed: false, stopped: false })
  expect(groupState(group({ rounds: [] }), now).text).toBe('Starting')
})

test('every way a group ends has its own line, with LilBot wording rather than the server text', () => {
  expect(groupState(ended('closed', 'Release moves to Friday.'), now)).toEqual({
    icon: null,
    text: 'Closed · 2 rounds, 6 turns, 11 min · outcome inside',
    failed: false,
    stopped: false
  })
  expect(groupState(ended('stopped', 'Stopped by Oscar in round 2.'), now)).toMatchObject({ text: 'Stopped by you · round 2', stopped: true })
  expect(groupState(ended('rounds'), now).text).toBe('Ended by itself · reached the 2-round limit')
  expect(groupState(ended('messages'), now).text).toBe('Ended by itself · reached the message limit')
  expect(groupState(ended('time'), now).text).toBe('Ended by itself · reached the time limit')
  expect(groupState(ended('quiet'), now).text).toBe('Ended by itself · went quiet')
  expect(groupState(ended('failed'), now).text).toBe('Ended by itself · its leader could not be reached')
})

test('the view: subtitle, round dividers, pending replies and the outcome card', () => {
  expect(groupSubtitle(group(), now)).toBe('Temporary group · led by FillLight Bot')
  expect(groupSubtitle(ended('closed'), now)).toBe('Group closed today 10:21 · led by FillLight Bot')
  expect(groupSubtitle(ended('quiet'), now)).toBe('Group ended today 10:21 · led by FillLight Bot')
  const [first, second] = group().group.rounds
  expect(roundLabel(group(), first, '10:10')).toBe('Round 1 · to everyone · 10:10')
  expect(roundLabel(group(), second, '10:14')).toBe('Round 2 · to Footy and HeardBack · 10:14')
  expect(roundLabel(group(), { ...second, to: ['footy', 'heard', 'lead'] }, '10:14')).toBe('Round 2 · to Footy and HeardBack · 10:14')
  expect(pendingReplies(group())).toEqual([
    { id: 'footy', name: footy.name, text: 'Footy President Bot replied', tone: 'finished' },
    { id: 'heard', name: heard.name, text: 'HeardBack Bot · Searching the web', tone: 'working' }
  ])
  // Every reply in: the leader at work on them shows instead.
  const answered = group({
    members: [
      { id: 'lead', state: 'working', activity: 'Reading replies' },
      { id: 'footy', state: 'replied', activity: null },
      { id: 'heard', state: 'replied', activity: null },
      { id: 'eng', state: 'idle', activity: null }
    ]
  })
  expect(pendingReplies(answered).map(row => row.text)).toEqual(['FillLight Bot · Reading replies', 'Footy President Bot replied', 'HeardBack Bot replied'])
  // Addressed and not started yet.
  const waiting = group({
    members: [
      { id: 'lead', state: 'idle', activity: null },
      { id: 'footy', state: 'replied', activity: null },
      { id: 'heard', state: 'waiting', activity: null }
    ]
  })
  expect(pendingReplies(waiting).at(-1)).toMatchObject({ text: 'HeardBack Bot · Waiting to start', tone: null })
  expect(pendingReplies(ended('closed'))).toEqual([])
  expect(outcomeCard(ended('closed', 'Release moves to Friday.'), now)).toEqual({ title: 'Outcome', stats: '2 rounds · 6 turns · 11 min', text: 'Release moves to Friday.' })
  expect(outcomeCard(ended('stopped', 'Stopped by Oscar in round 2.'), now)).toMatchObject({
    title: 'Stopped by you',
    text: 'You stopped this group in round 2, before the leader closed it.'
  })
  expect(outcomeCard(ended('rounds', 'Ended by itself at the round limit (2 rounds).'), now)).toMatchObject({
    title: 'Ended by itself',
    text: 'It reached the 2-round limit before the leader closed it.'
  })
  expect([...shortNames(group()).values()]).toEqual(['FillLight', 'Footy', 'HeardBack', 'Server'])
  const alike = group({}, { participants: [{ id: 'lead', name: 'Group Lead' }, { id: 'footy', name: 'Group Scout' }, heard, eng] })
  expect([...shortNames(alike).values()]).toEqual(['Group Lead', 'Group Scout', 'HeardBack', 'Server'])
  expect(roundLabel(alike, second, '10:14')).toBe('Round 2 · to Group Scout and HeardBack · 10:14')
  expect(stopSentence(group())).toBe('All four bots stop working on it now.')
})

test('the Activity card lists groups with the exchanges, running first', () => {
  expect(running(group())).toBe(true)
  expect(running(ended('closed'))).toBe(false)
  expect(groupActivityRow(group(), now)).toEqual({ title: 'Group · Agree the 1.2 launch plan', line: 'Running · round 2 · 4 bots' })
  expect(groupActivityRow({ ...ended('closed'), createdAt: T0 - 2 * 86_400_000 }, now).line).toBe('19 Nov · closed with an outcome')
  expect(groupActivityRow(ended('stopped'), now).line).toBe('Today 10:10 · stopped by you')
  expect(groupActivityRow(ended('quiet'), now).line).toBe('Today 10:10 · ended by itself · went quiet')
  const old = { ...ended('closed'), id: 'old', createdAt: T0 - MIN }
  expect(activityOrder([old, { ...group(), createdAt: T0 - 2 * MIN }]).map(t => t.id)).toEqual(['g1', 'old'])
})

test('the roster gathers each running group from its bots, the leader first', () => {
  const g = { id: 'g1', purpose: 'Agree the 1.2 launch plan', round: 2, roundCap: 6 }
  const bots = [
    { ...testBot('footy'), groups: [{ ...g, leading: false }] },
    {
      ...testBot('lead'),
      groups: [
        { ...g, leading: true },
        { ...g, id: 'g2', purpose: 'Price test', round: 1, leading: true }
      ]
    },
    testBot('idle'),
    { ...testBot('heard'), groups: [{ ...g, id: 'g2', purpose: 'Price test', round: 1, leading: false }] }
  ]
  const groups = runningGroups(bots)
  expect(groups.map(r => [r.id, r.purpose, r.round, r.bots.map(b => b.id)])).toEqual([
    ['g1', 'Agree the 1.2 launch plan', 2, ['lead', 'footy']],
    ['g2', 'Price test', 1, ['lead', 'heard']]
  ])
  expect(runningGroups([testBot('idle')])).toEqual([])
})
