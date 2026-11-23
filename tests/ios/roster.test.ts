import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { type BotActionsSocket, createBotActions } from '../../ios/src/bots/actions-core'
import { buildRosterListItems, rosterStatusNotice } from '../../ios/src/bots/roster-list'
import { detachedTabTriggerSpec, rosterMenuActions, rosterRowDisplay, rosterSwipeActionSpecs, tileSignal } from '../../ios/src/bots/roster-state'
import { type BotRosterSocket, createBotStore } from '../../ios/src/bots/store-core'
import { rowAccessibilityActions } from '../../ios/src/ui/gestures/rules'
import { BOT_MENU_LABELS } from '../../shared/client/bots/bot-menu-rules'
import { runningGroups } from '../../shared/client/bots/running-groups'
import { testBot as bot } from '../web/test-bot'

describe('Round 4 iOS Roster display, parity, scale, and store guards', () => {
  test('row display preserves simultaneous unread dot + status mark and primary star on non-tiled rows', () => {
    const workingAndUnread = rosterRowDisplay(bot('ledger', { activity: { status: 'working', text: 'Running commands', unread: true } }))
    expect(workingAndUnread.inlineText).toBe('Running commands')
    expect(workingAndUnread.statusMark).toBe('working')
    expect(workingAndUnread.unread).toBe(true)
    expect(workingAndUnread.boldName).toBe(true)

    const primaryIdle = rosterRowDisplay(bot('chief', { isPrimary: true }))
    expect(primaryIdle.showPrimaryStar).toBe(true)
    expect(primaryIdle.statusMark).toBeNull()

    const waiting = rosterRowDisplay(bot('relay', { activity: { status: 'waiting', unread: true } }))
    expect(waiting.inlineText).toBe('Waiting for you')
    expect(waiting.inlineTone).toBe('foreground')
    expect(waiting.statusMark).toBeNull()
    expect(waiting.unread).toBe(true)

    const failedAndUnread = rosterRowDisplay(bot('kestrel', { activity: { status: 'failed', unread: true } }))
    expect(failedAndUnread.inlineText).toBe('Failed')
    expect(failedAndUnread.inlineTone).toBe('destructive')
    expect(failedAndUnread.statusMark).toBe('failed')
    expect(failedAndUnread.unread).toBe(true)

    const finished = rosterRowDisplay(bot('foundry', { activity: { status: 'finished' } }))
    expect(finished.statusMark).toBe('finished')
    expect(rosterRowDisplay(bot('broken', { runnable: false })).inlineText).toBe('Runtime unavailable')
  })

  test('tileSignal renders primary star and never suppresses unread dot when working', () => {
    expect(tileSignal(bot('chief', { isPrimary: true }))).toEqual({ unread: false, working: false, showPrimaryStar: true })
    expect(tileSignal(bot('chief', { isPrimary: true, activity: { unread: true } }))).toEqual({ unread: true, working: false, showPrimaryStar: true })
    expect(tileSignal(bot('chief', { isPrimary: true, activity: { status: 'working', unread: true } }))).toEqual({
      unread: true,
      working: true,
      showPrimaryStar: false
    })
  })

  test('iOS menu, swipe, and VoiceOver labels equal shared web BOT_MENU_LABELS 1:1', () => {
    const hidden = bot('ghost', { prefs: { pinned: true, hidden: true }, activity: { unread: true } })
    const menu = rosterMenuActions(hidden, true)
    expect(menu.map(a => a.label)).toEqual([
      BOT_MENU_LABELS.unpin,
      BOT_MENU_LABELS.moveToSection,
      BOT_MENU_LABELS.markAsRead,
      BOT_MENU_LABELS.nameAndAvatar,
      BOT_MENU_LABELS.makePrimary,
      BOT_MENU_LABELS.show,
      BOT_MENU_LABELS.delete
    ])
    expect(rosterSwipeActionSpecs(hidden).map(a => a.accessibilityLabel)).toEqual([BOT_MENU_LABELS.unpin, BOT_MENU_LABELS.markAsRead, BOT_MENU_LABELS.show])
    expect(rosterSwipeActionSpecs(hidden).map(a => a.label)).toEqual(['Unpin', 'Read', 'Show'])
    expect(rowAccessibilityActions({ pinned: true, unread: true, hidden: true }).map(a => a.label)).toEqual([
      BOT_MENU_LABELS.unpin,
      BOT_MENU_LABELS.markAsRead,
      BOT_MENU_LABELS.show,
      'Bot menu'
    ])

    const primary = bot('chief', { isPrimary: true })
    expect(rosterMenuActions(primary, true).map(a => a.label)).toEqual([BOT_MENU_LABELS.markAsUnread, BOT_MENU_LABELS.nameAndAvatar, BOT_MENU_LABELS.changePrimaryBot])
    expect(rosterMenuActions(primary, false).find(a => a.id === 'primary')?.disabled).toBe(true)
    expect(rowAccessibilityActions({ pinned: false, unread: false, hidden: false, arrangeable: false }).map(a => a.label)).toEqual([BOT_MENU_LABELS.markAsUnread, 'Bot menu'])
  })

  test('status notice mirrors web sidebar and never shows No bots yet while connecting, loading, or failed', () => {
    expect(rosterStatusNotice({ loaded: false, connected: false, error: '', count: 0 })).toEqual({ text: 'Connecting...', tone: 'muted' })
    expect(rosterStatusNotice({ loaded: false, connected: true, error: '', count: 0 })).toEqual({ text: 'Loading bots...', tone: 'muted' })
    expect(rosterStatusNotice({ loaded: false, connected: true, error: 'Server unreachable', count: 0 })).toEqual({ text: 'Server unreachable', tone: 'destructive' })
    expect(rosterStatusNotice({ loaded: true, connected: true, error: 'Timeout', count: 0 })).toEqual({ text: 'Timeout', tone: 'destructive' })
    expect(rosterStatusNotice({ loaded: true, connected: true, error: '', count: 0 })).toEqual({ text: 'No bots yet.', tone: 'muted' })
    expect(rosterStatusNotice({ loaded: true, connected: true, error: '', count: 2 })).toBeNull()
  })

  test('detached native orb switches cleanly between New bot (+) on phone/folded Duo and New chat on unfolded Duo/iPad', () => {
    expect(detachedTabTriggerSpec(false)).toEqual({ action: 'new-bot', sf: 'plus', label: 'New bot', testID: 'new-bot-trigger' })
    expect(detachedTabTriggerSpec(true)).toEqual({ action: 'new-chat', sf: 'square.and.pencil', label: 'New chat', testID: 'new-chat-trigger' })
    const layoutSource = readFileSync(resolve(process.cwd(), 'ios/src/app/(tabs)/_layout.tsx'), 'utf8')
    expect(layoutSource).toContain('role="search"')
    expect(layoutSource).toContain('disabled')
    expect(layoutSource).toContain('detachedTabTriggerSpec(layout.splitMode)')
  })

  test('useBotStore monotonic sequence guard ignores stale out-of-order responses and errors', async () => {
    let resolveFirst!: (bots: ReturnType<typeof bot>[]) => void
    let resolveSecond!: (bots: ReturnType<typeof bot>[]) => void
    let rejectThird!: (err: Error) => void
    let callIdx = 0
    const socket: BotRosterSocket = {
      call: ((method: 'bots.list' | 'sections.list') => {
        if (method === 'sections.list') return Promise.resolve([])
        callIdx += 1
        if (callIdx === 1) return new Promise(r => (resolveFirst = r))
        if (callIdx === 2) return new Promise(r => (resolveSecond = r))
        if (callIdx === 3) return new Promise((_, rej) => (rejectThird = rej))
        return Promise.resolve([bot('newest')])
      }) as unknown as BotRosterSocket['call']
    }
    const store = createBotStore(() => socket)
    const p1 = store.getState().load()
    const p2 = store.getState().load()
    resolveSecond([bot('fresh')])
    await p2
    expect(store.getState().bots.map(b => b.id)).toEqual(['fresh'])
    resolveFirst([bot('stale')])
    await p1
    expect(store.getState().bots.map(b => b.id)).toEqual(['fresh'])

    const p3 = store.getState().load()
    const p4 = store.getState().load()
    await p4
    expect(store.getState().bots.map(b => b.id)).toEqual(['newest'])
    rejectThird(new Error('stale failure'))
    await p3
    expect(store.getState().error).toBe('')
    expect(store.getState().bots.map(b => b.id)).toEqual(['newest'])
  })

  test('bot actions report disconnect and server errors cleanly without throwing on inline actions', async () => {
    let lastError = ''
    let reloads = 0
    const disconnected = createBotActions({
      getSocket: () => null,
      reload: async () => {
        reloads += 1
      },
      upsert: () => {},
      setError: m => {
        lastError = m
      }
    })
    await disconnected.setBotPrefs({ botId: 'a', pinned: true })
    expect(lastError).toBe('Not connected to a LilBot server.')
    expect(reloads).toBe(0)
    await expect(disconnected.deleteBot('a', { files: 'archive', privateMemories: 'forget' })).rejects.toThrow('Not connected')

    const failingSocket: BotActionsSocket = {
      call: (async () => {
        throw new Error('Permission denied')
      }) as BotActionsSocket['call']
    }
    const failing = createBotActions({
      getSocket: () => failingSocket,
      reload: async () => {
        reloads += 1
      },
      upsert: () => {},
      setError: m => {
        lastError = m
      }
    })
    await failing.setBotUnread('a', true)
    expect(lastError).toBe('Permission denied')
    await failing.makeBotPrimary('a')
    expect(lastError).toBe('Permission denied')
    await expect(failing.moveToNewSection('a', 'Ops')).rejects.toThrow('Permission denied')
    expect(reloads).toBe(0)
  })

  test('virtualized list flattening handles 200 bots quickly with runningGroups leader-first ordering', () => {
    const sections = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, name: `Section ${i}` }))
    const bots = Array.from({ length: 200 }, (_, i) =>
      bot(`b${i}`, {
        isPrimary: i === 0,
        prefs: { pinned: i > 0 && i < 4, pinnedAt: i * 10, sectionId: i >= 4 && i < 180 ? `s${i % 5}` : null, hidden: i >= 190 }
      })
    )
    const t0 = performance.now()
    const items = buildRosterListItems({ bots, sections, loaded: true, connected: true, error: '', query: '', selectedId: null, unassignedOpen: false, hiddenOpen: false })
    const elapsedMs = performance.now() - t0
    expect(elapsedMs).toBeLessThan(50)
    expect(items[0]?.kind).toBe('tiles')
    expect(items.filter(i => i.kind === 'section-header')).toHaveLength(5)
    expect(items.filter(i => i.kind === 'bot')).toHaveLength(176)
    expect(items.filter(i => i.kind === 'group-toggle').map(i => i.name)).toEqual(['Unassigned', 'Hidden'])

    const member = { ...bot('m1'), groups: [{ id: 'g1', purpose: 'Launch checklist', round: 2, roundCap: 6, leading: false }] }
    const leader = { ...bot('l1'), groups: [{ id: 'g1', purpose: 'Launch checklist', round: 2, roundCap: 6, leading: true }] }
    expect(runningGroups([member, leader])[0]?.bots.map(b => b.id)).toEqual(['l1', 'm1'])
  })
})
