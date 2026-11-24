import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { rosterStatusNotice } from '../../ios/src/bots/roster-list'
import {
  canStartNewSession,
  detachedTabTriggerSpec,
  isBotsTabSegments,
  rosterMenuActions,
  rosterRowDisplay,
  rosterSwipeActionSpecs,
  sameRosterBotDisplay,
  tileSignal
} from '../../ios/src/bots/roster-state'
import { rowAccessibilityActions } from '../../ios/src/ui/gestures/rules'
import { BOT_MENU_LABELS } from '../../shared/client/bots/bot-menu-rules'
import { testBot as bot } from '../web/test-bot'

describe('Round 4 iOS Roster display, web label parity, and detached orb guards', () => {
  test('row display preserves simultaneous unread dot + status mark and primary star on non-tiled rows', () => {
    const workingAndUnread = rosterRowDisplay(bot('ledger', { activity: { status: 'working', text: 'Running commands', unread: true } }))
    expect(workingAndUnread.inlineText).toBe('Running commands')
    expect(workingAndUnread.statusMark).toBe('working')
    expect(workingAndUnread.unread).toBe(true)
    expect(workingAndUnread.boldName).toBe(true)

    const primaryIdle = rosterRowDisplay(bot('chief', { isPrimary: true, function: 'Coordinates daily priorities.' }))
    expect(primaryIdle.showPrimaryStar).toBe(true)
    expect(primaryIdle.statusMark).toBeNull()
    expect(primaryIdle.inlineText).toBe('Coordinates daily priorities.')
    expect(primaryIdle.inlineTone).toBe('muted')
    expect(primaryIdle.timeText).toBeNull()
    const rowSource = readFileSync(resolve(process.cwd(), 'ios/src/bots/roster-row.tsx'), 'utf8')
    expect(rowSource).toContain('{display.timeText ? (')

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
    expect(rosterSwipeActionSpecs(primary)).toEqual([{ id: 'toggle-unread', label: 'Unread', accessibilityLabel: BOT_MENU_LABELS.markAsUnread, tone: 'primary' }])
    expect(rosterSwipeActionSpecs(bot('chief', { isPrimary: true, activity: { unread: true } }))).toEqual([
      { id: 'toggle-unread', label: 'Read', accessibilityLabel: BOT_MENU_LABELS.markAsRead, tone: 'primary' }
    ])
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

  test('detached native orb switches cleanly across phone, Folded Duo, Unfolded Duo, and omits iPad top-tab capsule', () => {
    expect(detachedTabTriggerSpec({ surface: 'phone', chatFocused: false })).toEqual({ action: 'new-bot', sf: 'plus', label: 'New bot', testID: 'new-bot-trigger' })
    expect(detachedTabTriggerSpec({ surface: 'duo-unfolded-portrait', chatFocused: false })).toEqual({ action: 'new-bot', sf: 'plus', label: 'New bot', testID: 'new-bot-trigger' })
    expect(detachedTabTriggerSpec({ surface: 'duo-folded', chatFocused: false })).toEqual({ action: 'new-bot', sf: 'plus', label: 'New bot', testID: 'new-bot-trigger' })
    expect(detachedTabTriggerSpec({ surface: 'duo-folded', chatFocused: true })).toEqual({
      action: 'new-session',
      sf: 'square.and.pencil',
      label: 'New session',
      testID: 'new-session-trigger'
    })
    expect(detachedTabTriggerSpec({ surface: 'duo-unfolded-landscape', chatFocused: false })).toEqual({
      action: 'new-session',
      sf: 'square.and.pencil',
      label: 'New session',
      testID: 'new-session-trigger'
    })
    expect(detachedTabTriggerSpec({ surface: 'pad', chatFocused: false })).toBeNull()
    expect(detachedTabTriggerSpec({ surface: 'pad', chatFocused: true })).toBeNull()
    expect(isBotsTabSegments(['(tabs)', '(bots)'])).toBe(true)
    expect(isBotsTabSegments(['(tabs)', '(bots)', 'chat'])).toBe(true)
    expect(isBotsTabSegments(['(tabs)', 'settings'])).toBe(false)
    expect(canStartNewSession({ connected: true, ready: true, botsTabActive: true, selectedId: 'b1' })).toBe(true)
    expect(canStartNewSession({ connected: false, ready: true, botsTabActive: true, selectedId: 'b1' })).toBe(false)
    expect(canStartNewSession({ connected: true, ready: false, botsTabActive: true, selectedId: 'b1' })).toBe(false)
    expect(canStartNewSession({ connected: true, ready: true, botsTabActive: false, selectedId: 'b1' })).toBe(false)
    expect(canStartNewSession({ connected: true, ready: true, botsTabActive: true, selectedId: null })).toBe(false)

    const layoutSource = readFileSync(resolve(process.cwd(), 'ios/src/app/(tabs)/_layout.tsx'), 'utf8')
    expect(layoutSource).toContain('role="search"')
    expect(layoutSource).toContain('disabled')
    expect(layoutSource).toContain('detachedTabTriggerSpec({ surface, chatFocused })')
    expect(layoutSource).toContain('{trigger ? (')
    expect(layoutSource).toContain('canStartNewSession(')
    expect(layoutSource).toContain('<BotMenuHost />')

    const shellSource = readFileSync(resolve(process.cwd(), 'ios/src/duo/shell.tsx'), 'utf8')
    const newBotSource = readFileSync(resolve(process.cwd(), 'ios/src/bots/new-bot-sheet.tsx'), 'utf8')
    expect(shellSource).toContain('useConnectionStore(state => state.connected)')
    expect(shellSource).toContain("showNewSession={surface === 'pad'}")
    expect(newBotSource).toContain('useConnectionStore(state => state.connected)')
    expect(shellSource).not.toContain('useBotStore(state => state.connected)')
    expect(newBotSource).not.toContain('useBotStore(state => state.connected)')

    const chatScreenSource = readFileSync(resolve(process.cwd(), 'ios/src/chat/screen.tsx'), 'utf8')
    const compactChatSource = readFileSync(resolve(process.cwd(), 'ios/src/app/(tabs)/(bots)/chat.tsx'), 'utf8')
    expect(chatScreenSource).toMatch(/More for \$\{bot\.name\}/)
    expect(chatScreenSource).toContain('testID="chat-new-session-button"')
    expect(chatScreenSource).toContain('accessibilityLabel="New session"')
    expect(chatScreenSource).toContain('<NewChatIcon color={theme.foreground} size={16} />')
    expect(chatScreenSource).toContain('canStartNewSession(')
    expect(compactChatSource).toMatch(/More for \$\{bot\.name\}/)
  })

  test('sameRosterBotDisplay compares rendered Bot fields by value across fresh list clones', () => {
    const a = bot('clone', { activity: { status: 'working', text: 'Thinking', unread: true } })
    const b = bot('clone', { activity: { status: 'working', text: 'Thinking', unread: true } })
    const c = bot('clone', { activity: { status: 'working', text: 'Running commands', unread: true } })
    expect(sameRosterBotDisplay(a, b)).toBe(true)
    expect(sameRosterBotDisplay(a, c)).toBe(false)
  })
})
