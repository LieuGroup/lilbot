import { describe, expect, test } from 'bun:test'
import { chatStackAction, indexStackAction, shouldClearSelectionOnChatPop, shouldHideNativeTabBar, shouldShowNativeBack } from '../../ios/src/duo/stack-sync'

describe('native compact Stack <-> unfolded split synchronization', () => {
  test('pushes compact /chat on initial compact auto-select and on fold with an open bot', () => {
    expect(indexStackAction({ splitMode: false, wasSplitMode: false, selectedId: 'b1', chatMounted: false, justAutoSelected: true })).toBe('push-chat')
    expect(indexStackAction({ splitMode: false, wasSplitMode: true, selectedId: 'b1', chatMounted: false, justAutoSelected: false })).toBe('push-chat')
  })

  test('never double-pushes when /chat is already mounted, on split surfaces, or with no selection', () => {
    expect(indexStackAction({ splitMode: false, wasSplitMode: true, selectedId: 'b1', chatMounted: true, justAutoSelected: false })).toBe('none')
    expect(indexStackAction({ splitMode: true, wasSplitMode: false, selectedId: 'b1', chatMounted: false, justAutoSelected: true })).toBe('none')
    expect(indexStackAction({ splitMode: false, wasSplitMode: true, selectedId: null, chatMounted: false, justAutoSelected: false })).toBe('none')
    // Staying on compact Roster after user popped back: no auto-repush.
    expect(indexStackAction({ splitMode: false, wasSplitMode: false, selectedId: 'b1', chatMounted: false, justAutoSelected: false })).toBe('none')
  })

  test('pops compact /chat when unfolding to split mode or when the bot disappears', () => {
    expect(chatStackAction({ splitMode: true, hasBot: true })).toBe('pop-chat')
    expect(chatStackAction({ splitMode: false, hasBot: false })).toBe('pop-chat')
    expect(chatStackAction({ splitMode: false, hasBot: true })).toBe('none')
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
