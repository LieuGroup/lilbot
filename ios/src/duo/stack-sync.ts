/** Pure transition rules coordinating the 2-screen compact native Stack (`index` <-> `chat`) with unfolded split mode.
 *  Zero React Native imports so every fold, unfold, tab-focus, double-tap, back-button, and tab-bar path is unit-tested on Linux. */
import type { SurfaceKind } from './layout'

export type StackAction = 'none' | 'push-chat' | 'pop-chat'

/** Decides whether the index screen should push `/chat` when running in compact mode.
 *  Never pushes while the Bots tab is unfocused (e.g. while the user is on Settings) or while a push is in flight. */
export function indexStackAction(input: {
  focused: boolean
  splitMode: boolean
  wasSplitMode: boolean
  selectedId: string | null
  chatMounted: boolean
  pushPending: boolean
  pendingInitialPush: boolean
}): StackAction {
  if (!input.focused || input.splitMode || input.chatMounted || input.pushPending || !input.selectedId) return 'none'
  // Push when returning/folding from unfolded with an open bot, or completing the initial compact primary auto-select.
  if (input.wasSplitMode || input.pendingInitialPush) return 'push-chat'
  return 'none'
}

/** Guards compact Roster row taps so a rapid double-tap pushes strictly one `/chat` screen. */
export function shouldPushOnBotSelect(input: { splitMode: boolean; chatMounted: boolean; pushPending: boolean }): boolean {
  return !input.splitMode && !input.chatMounted && !input.pushPending
}

/** Decides whether the pushed compact `/chat` screen should pop back to the split view on unfold (or if the bot vanished).
 *  Only acts while `/chat` is focused so unfolding on Settings never hijacks the active tab or locks a pop flag. */
export function chatStackAction(input: { focused: boolean; splitMode: boolean; hasBot: boolean }): StackAction {
  if (!input.focused) return 'none'
  if (input.splitMode || !input.hasBot) return 'pop-chat'
  return 'none'
}

/** Decides whether popping `/chat` clears the selected bot: yes when the user popped in compact mode,
 *  never when popping solely because the device unfolded into split mode. */
export function shouldClearSelectionOnChatPop(splitMode: boolean): boolean {
  return !splitMode
}

/** Native stack Back button visibility on the pushed compact Chat screen:
 *  - Standard iPhone (`phone`): hidden at rest so UIKit's left-edge swipe replaces it (R4-03b), restored for VoiceOver.
 *  - Folded Duo (`duo-folded`): shown so UIKit places native Back in the 84 pt side strip (R4-01b).
 *  - Duo Unfolded Portrait (`duo-unfolded-portrait`): shown (dead-end guard). */
export function shouldShowNativeBack(surface: SurfaceKind, screenReaderEnabled: boolean): boolean {
  if (surface === 'phone') return screenReaderEnabled
  return true
}

/** True when the active route is a pushed detail screen inside a tab stack (`bot-details` or a Settings
 *  sub-section `[section]`) where compact iPhone hides the floating bottom NativeTabs bar. */
export function isPushedDetailSegments(segments: readonly string[]): boolean {
  return segments.includes('bot-details') || segments.includes('[section]')
}

/** Hides the bottom NativeTabs bar while focused in compact Chat or a pushed detail screen on surfaces
 *  where tabs sit at the bottom (Standard iPhone and Duo Unfolded Portrait), so the floating bar never
 *  covers the Composer or pushed content (R4-03b, R3-05, R3-07b). Keeps the 84 pt side strip visible on
 *  Folded Duo (R4-01b) and keeps tabs visible on Roster/Settings roots and Split surfaces. */
export function shouldHideNativeTabBar(surface: SurfaceKind, hideInCompactStack: boolean): boolean {
  return (surface === 'phone' || surface === 'duo-unfolded-portrait') && hideInCompactStack
}
