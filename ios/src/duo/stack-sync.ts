/** Pure transition rules coordinating the 2-screen compact native Stack (`index` <-> `chat`) with unfolded split mode.
 *  Zero React Native imports so every fold, unfold, launch, back-button, and tab-bar visibility path is unit-tested on Linux. */
import type { SurfaceKind } from './layout'

export type StackAction = 'none' | 'push-chat' | 'pop-chat'

/** Decides whether the index screen should push `/chat` when running in compact mode. */
export function indexStackAction(input: {
  splitMode: boolean
  wasSplitMode: boolean
  selectedId: string | null
  chatMounted: boolean
  justAutoSelected: boolean
}): StackAction {
  if (input.splitMode || input.chatMounted || !input.selectedId) return 'none'
  // Push when folding from unfolded with an open bot, or on initial primary auto-select on compact launch.
  if (input.wasSplitMode || input.justAutoSelected) return 'push-chat'
  return 'none'
}

/** Decides whether the pushed compact `/chat` screen should pop back to the split view on unfold (or if the bot vanished). */
export function chatStackAction(input: { splitMode: boolean; hasBot: boolean }): StackAction {
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

/** Hides the bottom NativeTabs bar while focused in compact Chat on surfaces where tabs sit at the bottom
 *  (Standard iPhone and Duo Unfolded Portrait), so the bar never covers the Composer (R4-03b).
 *  Keeps the 84 pt side strip visible on Folded Duo (R4-01b) and keeps tabs visible on Roster/Settings/Split. */
export function shouldHideNativeTabBar(surface: SurfaceKind, chatFocused: boolean): boolean {
  return (surface === 'phone' || surface === 'duo-unfolded-portrait') && chatFocused
}
