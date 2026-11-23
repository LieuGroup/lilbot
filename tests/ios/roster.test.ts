import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { NEW_BOT_TRIGGER_A11Y, rosterMenuActions, rosterRowDisplay, rosterSwipeActionSpecs, tileSignal } from '../../ios/src/bots/roster-state'
import { runningGroups } from '../../shared/client/bots/running-groups'
import { testBot as bot } from '../web/test-bot'

describe('Round 4 iOS Roster display & bot management rules', () => {
  test('maps shared rowState into compact single-line mobile row display and fixes unread vs working marks', () => {
    const workingVerbose = rosterRowDisplay(bot('ledger', { activity: { status: 'working', text: 'Running commands' } }))
    expect(workingVerbose.inlineText).toBe('Running commands')
    expect(workingVerbose.inlineTone).toBe('muted')
    expect(workingVerbose.trailingMark).toBe('working')
    expect(workingVerbose.boldName).toBe(false)

    const workingPlain = rosterRowDisplay(bot('beacon', { activity: { status: 'working', text: 'Working' } }))
    expect(workingPlain.inlineText).toBe('')
    expect(workingPlain.trailingMark).toBe('working')

    const waitingUnread = rosterRowDisplay(bot('relay', { activity: { status: 'waiting', unread: true } }))
    expect(waitingUnread.inlineText).toBe('Waiting for you')
    expect(waitingUnread.inlineTone).toBe('foreground')
    expect(waitingUnread.trailingMark).toBe('unread')
    expect(waitingUnread.boldName).toBe(true)

    const finished = rosterRowDisplay(bot('foundry', { activity: { status: 'finished' } }))
    expect(finished.inlineText).toBe('')
    expect(finished.trailingMark).toBe('finished')

    const failed = rosterRowDisplay(bot('kestrel', { activity: { status: 'failed' } }))
    expect(failed.inlineText).toBe('Failed')
    expect(failed.inlineTone).toBe('destructive')
    expect(failed.trailingMark).toBe('failed')

    const idleUnread = rosterRowDisplay(bot('vega', { function: 'Ops', activity: { unread: true } }))
    expect(idleUnread.inlineText).toBe('')
    expect(idleUnread.trailingMark).toBe('unread')
    expect(idleUnread.boldName).toBe(true)

    const idleQuiet = rosterRowDisplay(bot('quill', { function: 'Docs' }))
    expect(idleQuiet.inlineText).toBe('')
    expect(idleQuiet.trailingMark).toBeNull()

    const unavailable = rosterRowDisplay(bot('broken', { runnable: false }))
    expect(unavailable.inlineText).toBe('Runtime unavailable')
    expect(unavailable.trailingMark).toBeNull()

    const workers = rosterRowDisplay({ ...bot('atlas'), workers: { count: 2 } })
    expect(workers.inlineText).toBe('2 workers running')
    expect(workers.trailingMark).toBe('working')
  })

  test('swipe actions respect primary bot constraints and toggle labels cleanly', () => {
    const primary = bot('chief', { isPrimary: true })
    expect(rosterSwipeActionSpecs(primary)).toEqual([{ id: 'toggle-unread', label: 'Unread', tone: 'primary' }])

    const primaryUnread = bot('chief', { isPrimary: true, activity: { unread: true } })
    expect(rosterSwipeActionSpecs(primaryUnread)).toEqual([{ id: 'toggle-unread', label: 'Read', tone: 'primary' }])

    const ordinary = bot('relay', { activity: { unread: true } })
    expect(rosterSwipeActionSpecs(ordinary)).toEqual([
      { id: 'toggle-pin', label: 'Pin', tone: 'ink' },
      { id: 'toggle-unread', label: 'Read', tone: 'primary' },
      { id: 'toggle-hide', label: 'Hide', tone: 'muted' }
    ])

    const pinnedHidden = bot('ghost', { prefs: { pinned: true, hidden: true } })
    expect(rosterSwipeActionSpecs(pinnedHidden).map(a => a.label)).toEqual(['Unpin', 'Unread', 'Unhide'])
  })

  test('long-press bot menu matches web bot-menu rules 1:1', () => {
    const primary = bot('chief', { isPrimary: true })
    expect(rosterMenuActions(primary, true)).toEqual([
      { id: 'toggle-unread', label: 'Mark as unread' },
      { id: 'name-and-avatar', label: 'Name and avatar' },
      { id: 'primary', label: 'Change primary bot', disabled: false }
    ])
    expect(rosterMenuActions(primary, false).find(a => a.id === 'primary')?.disabled).toBe(true)

    const ordinary = bot('relay', { prefs: { pinned: true }, activity: { unread: true } })
    expect(rosterMenuActions(ordinary, true)).toEqual([
      { id: 'pin', label: 'Unpin' },
      { id: 'move-section', label: 'Move to section' },
      { id: 'toggle-unread', label: 'Mark as read' },
      { id: 'name-and-avatar', label: 'Name and avatar' },
      { id: 'primary', label: 'Make primary' },
      { id: 'hide', label: 'Hide' },
      { id: 'delete', label: 'Delete', destructive: true }
    ])
  })

  test('tileSignal distinguishes unread dot from working spinner and runningGroups orders leader first', () => {
    expect(tileSignal(bot('atlas', { activity: { unread: true } }))).toEqual({ unread: true, working: false })
    expect(tileSignal(bot('compass', { activity: { status: 'working' } }))).toEqual({ unread: false, working: true })

    const member = { ...bot('m1'), groups: [{ id: 'g1', purpose: 'Launch checklist for v1.4', round: 2, roundCap: 6, leading: false }] }
    const leader = { ...bot('l1'), groups: [{ id: 'g1', purpose: 'Launch checklist for v1.4', round: 2, roundCap: 6, leading: true }] }
    const groups = runningGroups([member, leader])
    expect(groups).toHaveLength(1)
    expect(groups[0].bots.map(b => b.id)).toEqual(['l1', 'm1'])
    expect(groups[0].round).toBe(2)
  })

  test('native + orb uses role=search with disabled selection prevention and New bot accessibility label', () => {
    expect(NEW_BOT_TRIGGER_A11Y.label).toBe('New bot')
    const layoutSource = readFileSync(resolve(process.cwd(), 'ios/src/app/(tabs)/_layout.tsx'), 'utf8')
    expect(layoutSource).toContain('role="search"')
    expect(layoutSource).toContain('disabled')
    expect(layoutSource).toContain('sf="plus"')
    expect(layoutSource).toContain('accessibilityLabel={NEW_BOT_TRIGGER_A11Y.label}')
    expect(layoutSource).toContain('openNewBot()')
  })
})
