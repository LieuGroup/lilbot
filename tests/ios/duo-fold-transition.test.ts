/** End-to-end fold-transition unit test combining chat store drafts/scroll, stack sync,
 *  Duo vertical strip items, header visibility, and bottom status line across posture changes. */
import { describe, expect, test } from 'bun:test'
import type { ReactElement } from 'react'
import { resolveChatStatusLine } from '../../ios/src/chat/status'
import { useChatStore } from '../../ios/src/chat/store'
import { computeShellLayout, type WindowMetrics } from '../../ios/src/duo/layout'
import { chatStackAction, indexStackAction, shouldClearSelectionOnChatPop } from '../../ios/src/duo/stack-sync'
import { buildDuoVerticalBarItems, DUO_VERTICAL_ITEM_PREFIX, resolveDuoStripScreen, shouldHideDuoChatHeader } from '../../ios/src/duo/vertical-bar'

const fakeAvatar = { type: 'view', props: {}, key: null } as unknown as ReactElement
const noop = () => {}

const unfoldedLandscape: WindowMetrics = { width: 951, height: 669, safeAreaRight: 84 }
const foldedMetrics: WindowMetrics = { width: 466, height: 678, safeAreaRight: 84 }
const unfoldedPortrait: WindowMetrics = { width: 669, height: 951 }

const fullActions = {
  'bot-avatar': { element: fakeAvatar, hidesSharedBackground: false },
  'sidebar-toggle': { label: 'Hide bots sidebar', onPress: noop },
  'bot-menu': { label: 'More for Chief of Staff', onPress: noop },
  'search-bots': { onPress: noop }
}

describe('iPhone Duo fold/unfold transition continuity', () => {
  test('preserves draft, scroll offset, selection, strip items, and header state across unfolded -> folded -> unfolded -> portrait', () => {
    const botId = 'chief-fold-test'
    useChatStore.setState({ slots: {} })
    useChatStore.getState().setDraft(botId, 'Keep this draft across fold')
    useChatStore.getState().setScrollOffset(botId, 148)

    const splitLayout = computeShellLayout('duo-unfolded-landscape', unfoldedLandscape)
    expect(splitLayout.splitMode).toBe(true)
    expect(shouldHideDuoChatHeader({ surface: 'duo-unfolded-landscape', verticalBarEdge: 'trailing', hasBot: true })).toBe(true)
    const splitItems = buildDuoVerticalBarItems({
      screen: resolveDuoStripScreen({ surface: 'duo-unfolded-landscape', chatFocused: false }),
      actions: fullActions
    })
    expect(splitItems.map(i => (i.type === 'custom' ? 'bot-avatar' : i.identifier))).toEqual([
      'bot-avatar',
      `${DUO_VERTICAL_ITEM_PREFIX}sidebar-toggle`,
      `${DUO_VERTICAL_ITEM_PREFIX}bot-menu`
    ])
    expect(resolveChatStatusLine({ connected: true, ready: true, running: true, activity: 'Working...' })).toEqual({
      text: 'Working...',
      tone: 'running'
    })

    // Fold to compact Duo: Bots tab pushes compact /chat; strip shrinks to avatar + more; header stays hidden.
    const foldedLayout = computeShellLayout('duo-folded', foldedMetrics)
    expect(foldedLayout.splitMode).toBe(false)
    expect(
      indexStackAction({
        focused: true,
        splitMode: foldedLayout.splitMode,
        wasSplitMode: splitLayout.splitMode,
        selectedId: botId,
        chatMounted: false,
        pushPending: false,
        pendingInitialPush: false
      })
    ).toBe('push-chat')
    expect(shouldHideDuoChatHeader({ surface: 'duo-folded', verticalBarEdge: 'trailing', hasBot: true })).toBe(true)
    const foldedItems = buildDuoVerticalBarItems({
      screen: resolveDuoStripScreen({ surface: 'duo-folded', chatFocused: true }),
      actions: fullActions
    })
    expect(foldedItems.map(i => (i.type === 'custom' ? 'bot-avatar' : i.identifier))).toEqual(['bot-avatar', `${DUO_VERTICAL_ITEM_PREFIX}bot-menu`])
    expect(useChatStore.getState().slots[botId]?.draft).toBe('Keep this draft across fold')
    expect(useChatStore.getState().slots[botId]?.scrollOffset).toBe(148)

    // Unfold back to landscape: compact /chat pops without clearing selected bot; 3 strip items return.
    expect(chatStackAction({ focused: true, splitMode: splitLayout.splitMode, hasBot: true })).toBe('pop-chat')
    expect(shouldClearSelectionOnChatPop(splitLayout.splitMode)).toBe(false)
    expect(useChatStore.getState().slots[botId]?.draft).toBe('Keep this draft across fold')
    expect(useChatStore.getState().slots[botId]?.scrollOffset).toBe(148)

    // Rotate to unfolded portrait: vertical strip turns off and standard Chat header returns cleanly.
    const portraitLayout = computeShellLayout('duo-unfolded-portrait', unfoldedPortrait)
    expect(portraitLayout.splitMode).toBe(false)
    expect(shouldHideDuoChatHeader({ surface: 'duo-unfolded-portrait', verticalBarEdge: 'trailing', hasBot: true })).toBe(false)
    expect(
      buildDuoVerticalBarItems({
        screen: resolveDuoStripScreen({ surface: 'duo-unfolded-portrait', chatFocused: true }),
        actions: fullActions
      })
    ).toEqual([])
    expect(useChatStore.getState().slots[botId]?.draft).toBe('Keep this draft across fold')
    expect(useChatStore.getState().slots[botId]?.scrollOffset).toBe(148)
  })

  test('does not yank navigation when folding/unfolding while Settings tab is focused, then syncs on return to Bots', () => {
    const botId = 'chief-settings-fold'
    useChatStore.setState({ slots: {} })
    useChatStore.getState().setDraft(botId, 'Settings tab open')

    const splitLayout = computeShellLayout('duo-unfolded-landscape', unfoldedLandscape)
    const foldedLayout = computeShellLayout('duo-folded', foldedMetrics)

    expect(
      indexStackAction({
        focused: false,
        splitMode: foldedLayout.splitMode,
        wasSplitMode: splitLayout.splitMode,
        selectedId: botId,
        chatMounted: false,
        pushPending: false,
        pendingInitialPush: false
      })
    ).toBe('none')
    expect(chatStackAction({ focused: false, splitMode: splitLayout.splitMode, hasBot: true })).toBe('none')

    // Returning to Bots triggers the deferred compact push while keeping the draft intact.
    expect(
      indexStackAction({
        focused: true,
        splitMode: foldedLayout.splitMode,
        wasSplitMode: splitLayout.splitMode,
        selectedId: botId,
        chatMounted: false,
        pushPending: false,
        pendingInitialPush: false
      })
    ).toBe('push-chat')
    expect(useChatStore.getState().slots[botId]?.draft).toBe('Settings tab open')
  })
})
