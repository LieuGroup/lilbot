import { describe, expect, test } from 'bun:test'
import { chatStackAction, indexStackAction, shouldClearSelectionOnChatPop, shouldHideNativeTabBar, shouldPushOnBotSelect, shouldShowNativeBack } from '../../ios/src/duo/stack-sync'

describe('native compact Stack <-> unfolded split synchronization', () => {
  test('pushes compact /chat on initial compact auto-select and on fold with an open bot while focused', () => {
    expect(
      indexStackAction({
        focused: true,
        splitMode: false,
        wasSplitMode: false,
        selectedId: 'b1',
        chatMounted: false,
        pushPending: false,
        pendingInitialPush: true
      })
    ).toBe('push-chat')
    expect(
      indexStackAction({
        focused: true,
        splitMode: false,
        wasSplitMode: true,
        selectedId: 'b1',
        chatMounted: false,
        pushPending: false,
        pendingInitialPush: false
      })
    ).toBe('push-chat')
  })

  test('never pushes or pops from an unfocused Bots tab (e.g. while on Settings), then syncs once returning to Bots', () => {
    // Folding or initial auto-select while on Settings must not yank the user out of Settings.
    expect(
      indexStackAction({
        focused: false,
        splitMode: false,
        wasSplitMode: true,
        selectedId: 'b1',
        chatMounted: false,
        pushPending: false,
        pendingInitialPush: false
      })
    ).toBe('none')
    expect(
      indexStackAction({
        focused: false,
        splitMode: false,
        wasSplitMode: false,
        selectedId: 'b1',
        chatMounted: false,
        pushPending: false,
        pendingInitialPush: true
      })
    ).toBe('none')
    // Unfolding while /chat is mounted on the background Bots tab must not pop from Settings.
    expect(chatStackAction({ focused: false, splitMode: true, hasBot: true })).toBe('none')
    // Returning to the Bots tab triggers the deferred sync once.
    expect(chatStackAction({ focused: true, splitMode: true, hasBot: true })).toBe('pop-chat')
    expect(
      indexStackAction({
        focused: true,
        splitMode: false,
        wasSplitMode: true,
        selectedId: 'b1',
        chatMounted: false,
        pushPending: false,
        pendingInitialPush: false
      })
    ).toBe('push-chat')
  })

  test('never double-pushes on rapid double-tap or when /chat is already mounted, on split surfaces, or with no selection', () => {
    expect(shouldPushOnBotSelect({ splitMode: false, chatMounted: false, pushPending: false })).toBe(true)
    expect(shouldPushOnBotSelect({ splitMode: false, chatMounted: false, pushPending: true })).toBe(false)
    expect(shouldPushOnBotSelect({ splitMode: false, chatMounted: true, pushPending: false })).toBe(false)
    expect(shouldPushOnBotSelect({ splitMode: true, chatMounted: false, pushPending: false })).toBe(false)

    expect(
      indexStackAction({
        focused: true,
        splitMode: false,
        wasSplitMode: true,
        selectedId: 'b1',
        chatMounted: true,
        pushPending: false,
        pendingInitialPush: false
      })
    ).toBe('none')
    expect(
      indexStackAction({
        focused: true,
        splitMode: false,
        wasSplitMode: true,
        selectedId: 'b1',
        chatMounted: false,
        pushPending: true,
        pendingInitialPush: false
      })
    ).toBe('none')
    expect(
      indexStackAction({
        focused: true,
        splitMode: true,
        wasSplitMode: false,
        selectedId: 'b1',
        chatMounted: false,
        pushPending: false,
        pendingInitialPush: true
      })
    ).toBe('none')
    expect(
      indexStackAction({
        focused: true,
        splitMode: false,
        wasSplitMode: true,
        selectedId: null,
        chatMounted: false,
        pushPending: false,
        pendingInitialPush: false
      })
    ).toBe('none')
    // Staying on compact Roster after user popped back: no auto-repush.
    expect(
      indexStackAction({
        focused: true,
        splitMode: false,
        wasSplitMode: false,
        selectedId: 'b1',
        chatMounted: false,
        pushPending: false,
        pendingInitialPush: false
      })
    ).toBe('none')
  })

  test('pops compact /chat when focused and unfolding to split mode or when the bot disappears', () => {
    expect(chatStackAction({ focused: true, splitMode: true, hasBot: true })).toBe('pop-chat')
    expect(chatStackAction({ focused: true, splitMode: false, hasBot: false })).toBe('pop-chat')
    expect(chatStackAction({ focused: true, splitMode: false, hasBot: true })).toBe('none')
  })

  test('clears selected bot only when popped in compact mode, never on unfold', () => {
    expect(shouldClearSelectionOnChatPop(false)).toBe(true)
    expect(shouldClearSelectionOnChatPop(true)).toBe(false)
  })

  test('hides native Back button at rest on Standard iPhone only, restoring for VoiceOver and keeping it on Duo', () => {
    expect(shouldShowNativeBack('phone', false)).toBe(false)
    expect(shouldShowNativeBack('phone', true)).toBe(true)
    expect(shouldShowNativeBack('duo-folded', false)).toBe(true)
    expect(shouldShowNativeBack('duo-unfolded-portrait', false)).toBe(true)
    expect(shouldShowNativeBack('duo-unfolded-landscape', false)).toBe(true)
  })

  test('hides bottom NativeTabs bar while focused in compact Chat on phone and Duo Unfolded Portrait, keeping Folded Duo rail visible', () => {
    expect(shouldHideNativeTabBar('phone', true)).toBe(true)
    expect(shouldHideNativeTabBar('phone', false)).toBe(false)
    expect(shouldHideNativeTabBar('duo-unfolded-portrait', true)).toBe(true)
    expect(shouldHideNativeTabBar('duo-unfolded-portrait', false)).toBe(false)
    expect(shouldHideNativeTabBar('duo-folded', true)).toBe(false)
    expect(shouldHideNativeTabBar('duo-unfolded-landscape', true)).toBe(false)
    expect(shouldHideNativeTabBar('pad', true)).toBe(false)
  })
})
