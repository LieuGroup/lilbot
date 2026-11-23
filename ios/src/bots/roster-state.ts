/** Pure Round 4 mobile Roster display rules, swipe actions, and context menu specs.
 *  Zero React Native runtime imports so unit tests verify every rule on Linux. */
import type { Bot } from '../../../shared/bot-schema'
import { canArrange, canDelete, isUnread } from '../../../shared/client/bots/bot-menu-rules'
import { type RowTone, rowState } from '../../../shared/client/bots/row-state'

export type TrailingMark = 'working' | 'finished' | 'failed' | 'unread' | null
export type InlineTextTone = 'destructive' | 'foreground' | 'muted'

export interface RosterRowDisplay {
  tone: RowTone
  unread: boolean
  boldName: boolean
  /** Compact inline status beside the bot name on 44 pt mobile rows (R4-03a / R4-01a). */
  inlineText: string
  inlineTone: InlineTextTone
  trailingMark: TrailingMark
  /** VoiceOver announcement matching web `botLabel`. */
  accessibilityLabel: string
}

export interface RosterSwipeSpec {
  id: 'toggle-pin' | 'toggle-unread' | 'toggle-hide'
  label: string
  tone: 'ink' | 'primary' | 'muted'
}

export interface RosterMenuActionSpec {
  id: 'pin' | 'move-section' | 'toggle-unread' | 'name-and-avatar' | 'primary' | 'hide' | 'delete'
  label: string
  destructive?: boolean
  disabled?: boolean
}

/** Accessibility metadata for the native `+` tab-bar trigger (`role="search"`, `sf="plus"`). */
export const NEW_BOT_TRIGGER_A11Y = {
  label: 'New bot',
  hint: 'Creates a new bot',
  testID: 'new-bot-trigger'
} as const

/** Maps shared `rowState(bot)` into Round 4's compact single-line Roster row presentation. */
export function rosterRowDisplay(bot: Bot): RosterRowDisplay {
  const state = rowState(bot)
  const accessibilityLabel = [bot.name, bot.isPrimary ? 'Primary bot' : '', state.text, state.unread ? 'Unread' : ''].filter(Boolean).join(', ')

  let inlineText = ''
  let inlineTone: InlineTextTone = 'muted'
  if (state.tone === 'waiting') {
    inlineText = state.text
    inlineTone = 'foreground'
  } else if (state.tone === 'failed') {
    inlineText = state.text
    inlineTone = 'destructive'
  } else if (state.tone === 'working' && state.text !== 'Working') {
    inlineText = state.text
    inlineTone = 'muted'
  } else if (state.tone === 'idle' && state.text === 'Runtime unavailable') {
    inlineText = state.text
    inlineTone = 'muted'
  }

  let trailingMark: TrailingMark = null
  if (state.tone === 'working') trailingMark = 'working'
  else if (state.tone === 'failed') trailingMark = 'failed'
  else if (state.tone === 'finished') trailingMark = 'finished'
  else if (state.unread) trailingMark = 'unread'

  return {
    tone: state.tone,
    unread: state.unread,
    boldName: state.unread,
    inlineText,
    inlineTone,
    trailingMark,
    accessibilityLabel
  }
}

/** Left-swipe pills (R4-G2): Pin · Read · Hide for ordinary bots; primary bot keeps only Read/Unread. */
export function rosterSwipeActionSpecs(bot: Bot): RosterSwipeSpec[] {
  const unread = isUnread(bot)
  const readAction: RosterSwipeSpec = { id: 'toggle-unread', label: unread ? 'Read' : 'Unread', tone: 'primary' }
  if (!canArrange(bot)) return [readAction]
  return [
    { id: 'toggle-pin', label: bot.prefs.pinned ? 'Unpin' : 'Pin', tone: 'ink' },
    readAction,
    { id: 'toggle-hide', label: bot.prefs.hidden ? 'Unhide' : 'Hide', tone: 'muted' }
  ]
}

/** Long-press bot menu items mirroring `web/src/bots/bot-menu.tsx` 1:1. */
export function rosterMenuActions(bot: Bot, hasPrimaryCandidates: boolean): RosterMenuActionSpec[] {
  const unread = isUnread(bot)
  const items: RosterMenuActionSpec[] = []
  if (canArrange(bot)) {
    items.push({ id: 'pin', label: bot.prefs.pinned ? 'Unpin' : 'Pin' })
    items.push({ id: 'move-section', label: 'Move to section' })
  }
  items.push({ id: 'toggle-unread', label: unread ? 'Mark as read' : 'Mark as unread' })
  items.push({ id: 'name-and-avatar', label: 'Name and avatar' })
  if (bot.isPrimary) {
    items.push({ id: 'primary', label: 'Change primary bot', disabled: !hasPrimaryCandidates })
  } else {
    items.push({ id: 'primary', label: 'Make primary' })
  }
  if (canArrange(bot)) {
    items.push({ id: 'hide', label: bot.prefs.hidden ? 'Unhide' : 'Hide' })
  }
  if (canDelete(bot)) {
    items.push({ id: 'delete', label: 'Delete', destructive: true })
  }
  return items
}

/** Compact tile badge signal (R4-03a / web AvatarMarks): blue unread dot or blue working spinner. */
export function tileSignal(bot: Bot): { unread: boolean; working: boolean } {
  const state = rowState(bot)
  return { unread: state.unread, working: state.tone === 'working' }
}
