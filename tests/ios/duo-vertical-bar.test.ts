/** Unit tests for iPhone Duo's single-table vertical side-strip configuration, availability guards,
 *  avatar-in-strip + header-removal rules, ordinary iPhone/iPad preservation, and overflow invariants. */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReactElement } from 'react'
import { resolveChatStatusLine } from '../../ios/src/chat/status'
import {
  buildDuoVerticalBarItems,
  DUO_AVATAR_TEST_ID,
  DUO_VERTICAL_BAR_TABLE,
  DUO_VERTICAL_ITEM_PREFIX,
  duoAvatarAccessibilityLabel,
  duoVerticalHeaderOptions,
  isDuoVerticalBarActive,
  resolveDuoStripScreen,
  shouldHideDuoChatHeader,
  shouldShowInlineSidebarToggle
} from '../../ios/src/duo/vertical-bar'

const fakeElement = { type: 'view', props: {}, key: null } as unknown as ReactElement

describe('iPhone Duo native vertical side-strip table and availability guards', () => {
  test('isDuoVerticalBarActive and shouldHideDuoChatHeader stay strictly gated on iOS 27.1+ Duo strip surfaces', () => {
    expect(isDuoVerticalBarActive({ surface: 'duo-folded', verticalBarEdge: null })).toBe(false)
    expect(isDuoVerticalBarActive({ surface: 'duo-unfolded-landscape', verticalBarEdge: null })).toBe(false)
    expect(isDuoVerticalBarActive({ surface: 'phone', verticalBarEdge: 'trailing' })).toBe(false)
    expect(isDuoVerticalBarActive({ surface: 'pad', verticalBarEdge: 'trailing' })).toBe(false)
    expect(isDuoVerticalBarActive({ surface: 'duo-unfolded-portrait', verticalBarEdge: 'trailing' })).toBe(false)
    expect(isDuoVerticalBarActive({ surface: 'duo-folded', verticalBarEdge: 'trailing' })).toBe(true)
    expect(isDuoVerticalBarActive({ surface: 'duo-unfolded-landscape', verticalBarEdge: 'leading' })).toBe(true)

    expect(shouldHideDuoChatHeader({ surface: 'duo-folded', verticalBarEdge: 'trailing', hasBot: true })).toBe(true)
    expect(shouldHideDuoChatHeader({ surface: 'duo-unfolded-landscape', verticalBarEdge: 'trailing', hasBot: true })).toBe(true)
    expect(shouldHideDuoChatHeader({ surface: 'duo-folded', verticalBarEdge: 'trailing', hasBot: false })).toBe(false)
    expect(shouldHideDuoChatHeader({ surface: 'duo-unfolded-portrait', verticalBarEdge: 'trailing', hasBot: true })).toBe(false)
    expect(shouldHideDuoChatHeader({ surface: 'phone', verticalBarEdge: 'trailing', hasBot: true })).toBe(false)
    expect(shouldHideDuoChatHeader({ surface: 'pad', verticalBarEdge: 'trailing', hasBot: true })).toBe(false)
    expect(shouldHideDuoChatHeader({ surface: 'duo-folded', verticalBarEdge: null, hasBot: true })).toBe(false)
  })

  test('duoAvatarAccessibilityLabel preserves bot name, working state, and unread state', () => {
    expect(duoAvatarAccessibilityLabel({ name: 'Chief of Staff', running: false, unread: false })).toBe('Chief of Staff')
    expect(duoAvatarAccessibilityLabel({ name: 'Chief of Staff', running: true, unread: false })).toBe('Chief of Staff, working')
    expect(duoAvatarAccessibilityLabel({ name: 'Chief of Staff', running: true, unread: true })).toBe('Chief of Staff, working, unread')
    expect(duoAvatarAccessibilityLabel({ name: 'Foundry', running: false, unread: true })).toBe('Foundry, unread')
  })

  test('shouldShowInlineSidebarToggle and resolveDuoStripScreen map every surface cleanly', () => {
    expect(shouldShowInlineSidebarToggle({ showSidebarToggle: true, verticalBarActive: false })).toBe(true)
    expect(shouldShowInlineSidebarToggle({ showSidebarToggle: true, verticalBarActive: true })).toBe(false)
    expect(shouldShowInlineSidebarToggle({ showSidebarToggle: false, verticalBarActive: true })).toBe(false)

    expect(resolveDuoStripScreen({ surface: 'phone', chatFocused: false })).toBeNull()
    expect(resolveDuoStripScreen({ surface: 'pad', chatFocused: false })).toBeNull()
    expect(resolveDuoStripScreen({ surface: 'duo-folded', chatFocused: false })).toBe('folded-roster')
    expect(resolveDuoStripScreen({ surface: 'duo-folded', chatFocused: true })).toBe('folded-chat')
    expect(resolveDuoStripScreen({ surface: 'duo-unfolded-landscape', chatFocused: false })).toBe('unfolded-split')
    expect(resolveDuoStripScreen({ surface: 'duo-unfolded-portrait', chatFocused: true })).toBe('unfolded-portrait')
  })

  test('DUO_VERTICAL_BAR_TABLE places bot-avatar first on Duo chat surfaces and keeps overflow labels intact', () => {
    expect(DUO_AVATAR_TEST_ID).toBe(`${DUO_VERTICAL_ITEM_PREFIX}bot-avatar`)
    expect(DUO_VERTICAL_BAR_TABLE['folded-roster'].map(s => s.id)).toEqual(['search-bots'])
    expect(DUO_VERTICAL_BAR_TABLE['folded-chat'].map(s => s.id)).toEqual(['bot-avatar', 'bot-menu'])
    expect(DUO_VERTICAL_BAR_TABLE['unfolded-split'].map(s => s.id)).toEqual(['bot-avatar', 'sidebar-toggle', 'bot-menu', 'new-bot', 'search-bots'])
    expect(DUO_VERTICAL_BAR_TABLE['unfolded-portrait']).toEqual([])

    for (const slots of Object.values(DUO_VERTICAL_BAR_TABLE)) {
      for (const slot of slots) {
        expect(slot.defaultLabel.trim().length).toBeGreaterThan(0)
        if (slot.kind === 'button') expect(slot.sfSymbol.trim().length).toBeGreaterThan(0)
        expect(['high', 'standard', 'low']).toContain(slot.priority)
      }
    }
  })

  test('buildDuoVerticalBarItems preserves table order with shipped avatar + more and prefixes ids', () => {
    const noop = () => {}
    const unfolded = buildDuoVerticalBarItems({
      screen: 'unfolded-split',
      actions: {
        'search-bots': { onPress: noop },
        'bot-menu': { label: 'More for Chief', onPress: noop },
        'sidebar-toggle': { label: 'Hide bots sidebar', onPress: noop },
        'new-bot': { onPress: noop },
        'bot-avatar': { element: fakeElement, hidesSharedBackground: false }
      },
      tintColor: '#111111'
    })
    expect(unfolded.map(i => (i.type === 'custom' ? 'custom:bot-avatar' : i.identifier))).toEqual([
      'custom:bot-avatar',
      `${DUO_VERTICAL_ITEM_PREFIX}sidebar-toggle`,
      `${DUO_VERTICAL_ITEM_PREFIX}bot-menu`,
      `${DUO_VERTICAL_ITEM_PREFIX}new-bot`,
      `${DUO_VERTICAL_ITEM_PREFIX}search-bots`
    ])
    expect(unfolded[0]).toEqual({ type: 'custom', element: fakeElement, hidesSharedBackground: false })

    const folded = buildDuoVerticalBarItems({
      screen: 'folded-chat',
      actions: {
        'bot-avatar': { element: fakeElement },
        'bot-menu': { label: '   ', onPress: noop }
      }
    })
    expect(folded).toHaveLength(2)
    expect(folded[0]?.type).toBe('custom')
    expect(folded[1]).toMatchObject({ type: 'button', identifier: `${DUO_VERTICAL_ITEM_PREFIX}bot-menu`, label: 'Bot options' })
    expect(buildDuoVerticalBarItems({ screen: null, actions: { 'sidebar-toggle': { onPress: noop } } })).toEqual([])
    expect(buildDuoVerticalBarItems({ screen: 'unfolded-portrait', actions: { 'sidebar-toggle': { onPress: noop } } })).toEqual([])
  })

  test('resolveChatStatusLine matches web wording for connection, opening, working, and idle states', () => {
    expect(resolveChatStatusLine({ connected: false, ready: false, running: false, activity: '' })).toEqual({ text: 'Reconnecting...', tone: 'muted' })
    expect(resolveChatStatusLine({ connected: false, ready: true, running: true, activity: 'Working...' })).toEqual({ text: 'Reconnecting...', tone: 'muted' })
    expect(resolveChatStatusLine({ connected: true, ready: false, running: false, activity: '' })).toEqual({ text: 'Opening chat...', tone: 'muted' })
    expect(resolveChatStatusLine({ connected: true, ready: true, running: true, activity: 'Working...' })).toEqual({ text: 'Working...', tone: 'running' })
    expect(resolveChatStatusLine({ connected: true, ready: true, running: true, activity: 'Thinking...' })).toEqual({ text: 'Thinking...', tone: 'running' })
    expect(resolveChatStatusLine({ connected: true, ready: true, running: true, activity: 'Using terminal...' })).toEqual({ text: 'Using terminal...', tone: 'running' })
    expect(resolveChatStatusLine({ connected: true, ready: true, running: true, activity: '' })).toBeNull()
    expect(resolveChatStatusLine({ connected: true, ready: true, running: false, activity: 'Working...' })).toBeNull()
    expect(resolveChatStatusLine({ connected: true, ready: true, running: false, activity: '' })).toBeNull()
  })

  test('duoVerticalHeaderOptions hides header when inactive and returns transparent zero-title options when active', () => {
    expect(duoVerticalHeaderOptions([], '#111111')).toEqual({ headerShown: false, unstable_headerRightItems: undefined })
    const items = buildDuoVerticalBarItems({ screen: 'folded-chat', actions: { 'bot-avatar': { element: fakeElement } } })
    const active = duoVerticalHeaderOptions(items, '#111111', { backVisible: true })
    expect(active.headerShown).toBe(true)
    expect(active.title).toBe('')
    expect(active.headerTitle).toBeUndefined()
    expect(active.headerTransparent).toBe(true)
    expect(active.headerShadowVisible).toBe(false)
    expect(active.headerBackVisible).toBe(true)
    expect(active.unstable_headerRightItems?.()).toEqual(items)
  })

  test('DuoShell, CompactChatRoute, ChatScreen, and MessageList wire avatar + more in strip, header removal, and bottom status line', () => {
    const shellSource = readFileSync(resolve(process.cwd(), 'ios/src/duo/shell.tsx'), 'utf8')
    const chatRouteSource = readFileSync(resolve(process.cwd(), 'ios/src/app/(tabs)/(bots)/chat.tsx'), 'utf8')
    const chatScreenSource = readFileSync(resolve(process.cwd(), 'ios/src/chat/screen.tsx'), 'utf8')
    const messageListSource = readFileSync(resolve(process.cwd(), 'ios/src/chat/message-list.tsx'), 'utf8')
    expect(shellSource).toContain('shouldHideDuoChatHeader(')
    expect(shellSource).toContain('DuoStripAvatar')
    expect(chatRouteSource).toContain('shouldHideDuoChatHeader(')
    expect(chatRouteSource).toContain('DuoStripAvatar')
    expect(chatScreenSource).toContain('resolveChatStatusLine(')
    expect(messageListSource).toContain('ListHeaderComponent=')
    expect(messageListSource).toContain('testID="chat-status-line"')
    expect(messageListSource).not.toContain('ListFooterComponent')
  })
})
