import { expect, test } from 'bun:test'
import { activitySince, formatElapsed } from '../../web/src/activity/activity-since'
import { railGroups, rosterGroups, searchBots } from '../../web/src/bots/roster-groups'
import { rowState } from '../../web/src/bots/row-state'
import { testBot as bot } from './test-bot'

const sections = [
  { id: 's1', name: 'Product' },
  { id: 's2', name: 'Engineer' },
  { id: 's3', name: 'Empty' }
]

test('the roster groups bots: primary and pinned tiles on top, sections in order, then unassigned and hidden', () => {
  const bots = [
    bot('loose'),
    bot('eng', { prefs: { sectionId: 's2' } }),
    bot('main', { isPrimary: true, prefs: { sectionId: 's1', hidden: true } }),
    bot('prod', { prefs: { sectionId: 's1' } }),
    bot('pinned-late', { prefs: { sectionId: 's1', pinned: true, pinnedAt: 300 } }),
    bot('pinned-early', { prefs: { pinned: true, pinnedAt: 100 } }),
    bot('gone-section', { prefs: { sectionId: 'deleted' } }),
    bot('secret', { prefs: { sectionId: 's2', hidden: true } }),
    bot('pinned-secret', { prefs: { pinned: true, pinnedAt: 50, hidden: true } })
  ]
  const groups = rosterGroups(bots, sections)
  expect(groups.top.map(bot => bot.id)).toEqual(['main', 'pinned-early', 'pinned-late'])
  expect(groups.tiled).toBe(true)
  expect(groups.sections.map(group => [group.section.name, group.bots.map(bot => bot.id)])).toEqual([
    ['Product', ['prod']],
    ['Engineer', ['eng']]
  ])
  expect(groups.unassigned.map(bot => bot.id)).toEqual(['loose', 'gone-section'])
  expect(groups.hidden.map(bot => bot.id)).toEqual(['secret', 'pinned-secret'])
})

test('pinned tiles keep pin order; bots pinned at the same time go by name', () => {
  const bots = [bot('Zed', { prefs: { pinned: true, pinnedAt: 5 } }), bot('amy', { prefs: { pinned: true, pinnedAt: 5 } }), bot('first', { prefs: { pinned: true, pinnedAt: 1 } })]
  expect(rosterGroups(bots, []).top.map(bot => bot.id)).toEqual(['first', 'amy', 'Zed'])
})

test('with nothing pinned there are no tiles: the primary is the first row', () => {
  const main = bot('main', { isPrimary: true })
  const alone = rosterGroups([bot('loose'), main], [])
  expect(alone.top).toEqual([main])
  expect(alone.tiled).toBe(false)
  // A pinned bot that is hidden stays in Hidden, so it makes no tiles either.
  expect(rosterGroups([main, bot('secret', { prefs: { pinned: true, pinnedAt: 1, hidden: true } })], []).tiled).toBe(false)
  expect(rosterGroups([main, bot('pinned', { prefs: { pinned: true, pinnedAt: 1 } })], []).tiled).toBe(true)
})

test('grouping leaves the bot list in its order', () => {
  const bots = [bot('a'), bot('b', { isPrimary: true }), bot('c', { prefs: { pinned: true, pinnedAt: 1 } })]
  rosterGroups(bots, [])
  expect(bots.map(bot => bot.id)).toEqual(['a', 'b', 'c'])
})

test('the rail keeps the roster order and leaves out groups that are closed there', () => {
  const ids = (lists: ReturnType<typeof railGroups>) => lists.map(list => list.map(bot => bot.id))
  const bots = [bot('main', { isPrimary: true }), bot('prod', { prefs: { sectionId: 's1' } }), bot('loose'), bot('secret', { prefs: { hidden: true } })]
  const groups = rosterGroups(bots, sections)
  expect(ids(railGroups(groups, () => false))).toEqual([['main'], ['prod']])
  expect(ids(railGroups(groups, group => group === 'hidden'))).toEqual([['main'], ['prod'], ['secret']])
  expect(ids(railGroups(groups, group => group === 'unassigned'))).toEqual([['main'], ['prod'], ['loose']])
  // With no sections, unassigned bots are a plain list in the roster, so they are in the rail too.
  expect(ids(railGroups(rosterGroups(bots, []), () => false))).toEqual([['main'], ['prod', 'loose']])
  // The primary leads the rail whether or not anything is pinned.
  const pinned = rosterGroups([...bots, bot('pin', { prefs: { pinned: true, pinnedAt: 1 } })], sections)
  expect(ids(railGroups(pinned, () => false))).toEqual([['main', 'pin'], ['prod']])
})

test('search matches every word in the name or function, hidden bots included', () => {
  const bots = [bot('Server Engineer', { function: 'Keeps the leader running' }), bot('Release Notes', { prefs: { hidden: true } })]
  expect(searchBots(bots, 'leader server').map(bot => bot.id)).toEqual(['Server Engineer'])
  expect(searchBots(bots, 'notes').map(bot => bot.id)).toEqual(['Release Notes'])
  expect(searchBots(bots, '  ')).toHaveLength(2)
})

test('each activity status maps to its row state and words', () => {
  const state = (activity?: NonNullable<Parameters<typeof bot>[1]>['activity']) => rowState(bot('b', { function: 'Ships builds', activity }))
  expect(state({ status: 'working', text: 'Running commands' })).toEqual({ tone: 'working', text: 'Running commands', unread: false })
  expect(state({ status: 'working', text: '' }).text).toBe('Working')
  const handed = { ...bot('b', { activity: { status: 'working', text: '' } }), workingFor: { threadId: 't', name: 'FillLight Bot' } }
  expect(rowState(handed).text).toBe('For FillLight Bot · Working')
  expect(state({ status: 'waiting', text: 'Waiting for Oscar', unread: true })).toEqual({ tone: 'waiting', text: 'Waiting for you', unread: true })
  expect(state({ status: 'finished', text: 'Finished' })).toEqual({ tone: 'finished', text: 'Finished', unread: false })
  expect(state({ status: 'failed', text: 'Failed', unread: true })).toEqual({ tone: 'failed', text: 'Failed', unread: true })
  expect(state({ status: 'idle', text: '', unread: true })).toEqual({ tone: 'idle', text: 'Ships builds', unread: true })
  expect(state()).toEqual({ tone: 'idle', text: 'Ships builds', unread: false })
  const g = { id: 'g', purpose: 'Plan', round: 1, roundCap: 6 }
  const member = (activity?: NonNullable<Parameters<typeof bot>[1]>['activity'], leading = false) => ({
    ...bot('b', { function: 'Ships builds', activity }),
    groups: [{ ...g, leading }]
  })
  expect(rowState(member())).toEqual({ tone: 'idle', text: 'In a group', unread: false })
  expect(rowState(member(undefined, true)).text).toBe('Leading a group')
  expect(
    rowState({
      ...member(),
      groups: [
        { ...g, leading: false },
        { ...g, id: 'h', leading: true }
      ]
    }).text
  ).toBe('Leading a group')
  expect(rowState(member({ status: 'working', text: 'Searching the web' }))).toEqual({ tone: 'working', text: 'In a group · Searching the web', unread: false })
  expect(rowState(member({ status: 'working', text: '' }, true)).text).toBe('Leading a group · Working')
  // What the bot does in the group beats its general activity text; a handed-over task still wins over the group.
  const busy = (activity: string, leading = false) => ({ ...member({ status: 'working', text: 'Working' }, leading), groups: [{ ...g, leading, activity }] })
  expect(rowState(busy('Running commands')).text).toBe('In a group · Running commands')
  expect(rowState(busy('Searching the web', true)).text).toBe('Leading a group · Searching the web')
  expect(rowState({ ...busy('Running commands'), workingFor: { threadId: 't', name: 'FillLight Bot' } }).text).toBe('For FillLight Bot · Working')
  expect(rowState({ ...member(undefined, true), groups: [{ ...g, leading: true, activity: 'Running commands' }] }).text).toBe('Leading a group')
  // A handed-over task is the turn running now; waiting for Oscar and an unavailable runtime win over the group.
  expect(rowState({ ...member({ status: 'working', text: '' }), workingFor: { threadId: 't', name: 'FillLight Bot' } }).text).toBe('For FillLight Bot · Working')
  expect(rowState(member({ status: 'waiting', text: '' })).text).toBe('Waiting for you')
  expect(rowState({ ...member(), runnable: false }).text).toBe('Runtime unavailable')
  expect(rowState(bot('b')).text).toBe('No function set')
  expect(rowState(bot('b', { runnable: false })).text).toBe('Runtime unavailable')
  expect(rowState(bot('b', { runnable: false, runtimePending: true, function: 'x' })).text).toBe('x')
})

test('a live state gets a start time only when this browser saw it begin', () => {
  const idle = bot('a', { activity: { status: 'idle' } })
  const working = bot('a', { activity: { status: 'working', text: 'Running commands' } })
  const searching = bot('a', { activity: { status: 'working', text: 'Searching the web' } })
  // Already working when the page loaded: unknown start.
  expect(activitySince([], {}, [working], 100)).toEqual({})
  expect(activitySince([working], {}, [working], 200)).toEqual({})
  // Seen to start, then kept while unchanged, restarted when the activity changes, dropped at idle.
  const started = activitySince([idle], {}, [working], 300)
  expect(started).toEqual({ a: 300 })
  expect(activitySince([working], started, [working], 400)).toEqual({ a: 300 })
  expect(activitySince([working], started, [searching], 500)).toEqual({ a: 500 })
  expect(activitySince([searching], { a: 500 }, [idle], 600)).toEqual({})
})

test('elapsed time reads in plain words', () => {
  expect(formatElapsed(30_000)).toBe('just now')
  expect(formatElapsed(4 * 60_000)).toBe('4 min')
  expect(formatElapsed(125 * 60_000)).toBe('2 h')
})

test('a bot running workers shows their count and live activity when idle, while its own reply and group stay ahead', () => {
  const idleWithOne = { ...bot('a', { activity: { status: 'idle' } }), workers: { count: 1, activity: 'Running tests' } }
  expect(rowState(idleWithOne)).toEqual({ tone: 'working', text: '1 worker · Running tests', unread: false })
  const quietOne = { ...bot('a'), workers: { count: 1 } }
  expect(rowState(quietOne)).toEqual({ tone: 'working', text: '1 worker · Working', unread: false })
  const two = { ...bot('a', { activity: { status: 'idle', unread: true } }), workers: { count: 2 } }
  expect(rowState(two)).toEqual({ tone: 'working', text: '2 workers running', unread: true })
  // Bot's own active reply in main chat stays ahead of background workers.
  const both = { ...bot('a', { activity: { status: 'working', text: 'Running commands' } }), workers: { count: 1, activity: 'Running tests' } }
  expect(rowState(both)).toEqual({ tone: 'working', text: 'Running commands', unread: false })
  // Active group turn also stays ahead of background workers.
  const g = { id: 'g1', purpose: 'Compare plans', round: 1, bots: 2, leading: true, activity: 'Searching the web' }
  const inGroup = { ...bot('a', { activity: { status: 'working', text: 'Working' } }), groups: [g], workers: { count: 2 } }
  expect(rowState(inGroup)).toEqual({ tone: 'working', text: 'Leading a group · Searching the web', unread: false })
  // Transient main-chat finished falls through to still-running workers; waiting for Oscar wins over all.
  const finWithWorker = { ...bot('a', { activity: { status: 'finished' } }), workers: { count: 1, activity: 'Running tests' } }
  expect(rowState(finWithWorker)).toEqual({ tone: 'working', text: '1 worker · Running tests', unread: false })
  const waiting = { ...bot('a', { activity: { status: 'waiting', unread: true } }), workers: { count: 1, activity: 'Running tests' } }
  expect(rowState(waiting)).toEqual({ tone: 'waiting', text: 'Waiting for you', unread: true })
  // activitySince tracks worker state when the bot's own chat is idle.
  const idle = bot('a', { activity: { status: 'idle' } })
  expect(activitySince([idle], {}, [idleWithOne], 700)).toEqual({ a: 700 })
})
