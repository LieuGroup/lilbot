/** Pure mobile Roster display rules, swipe actions, detached orb trigger, and context menu specs.
 *  Zero React Native runtime imports so unit tests verify every rule on Linux. */
import type { Bot } from '../../../shared/bot-schema'
import {
  BOT_MENU_LABELS,
  canArrange,
  canDelete,
  isUnread,
  pinActionLabel,
  unreadActionLabel,
  visibilityActionLabel
} from '../../../shared/client/bots/bot-menu-rules'
import { type RowTone, rowState } from '../../../shared/client/bots/row-state'

export type RowStatusMark = 'working' | 'finished' | 'failed' | null
export type InlineTextTone = 'destructive' | 'foreground' | 'muted'

export interface RosterRowDisplay {
  tone: RowTone
  unread: boolean
  boldName: boolean
  showPrimaryStar: boolean
  inlineText: string
  inlineTone: InlineTextTone
  statusMark: RowStatusMark
  accessibilityLabel: string
}

export interface RosterSwipeSpec {
  id: 'toggle-pin' | 'toggle-unread' | 'toggle-hide'
  label: string
  accessibilityLabel: string
  tone: 'ink' | 'primary' | 'muted'
}

export interface RosterMenuActionSpec {
  id: 'pin' | 'move-section' | 'toggle-unread' | 'name-and-avatar' | 'primary' | 'hide' | 'delete'
  label: string
  destructive?: boolean
  disabled?: boolean
}

export interface DetachedTabTriggerSpec {
  action: 'new-bot' | 'new-chat'
  sf: 'plus' | 'square.and.pencil'
  label: string
  testID: string
}

/** Detached native tab-bar trigger spec: New bot (+) on compact phones/folded Duo, New chat on unfolded Duo/iPad split. */
export function detachedTabTriggerSpec(splitMode: boolean): DetachedTabTriggerSpec {
  return splitMode
    ? { action: 'new-chat', sf: 'square.and.pencil', label: 'New chat', testID: 'new-chat-trigger' }
    : { action: 'new-bot', sf: 'plus', label: 'New bot', testID: 'new-bot-trigger' }
}

/** Maps shared rowState(bot) into compact single-line Roster row presentation without suppressing simultaneous unread + status. */
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

  const statusMark: RowStatusMark = state.tone === 'working' || state.tone === 'failed' || state.tone === 'finished' ? state.tone : null

  return {
    tone: state.tone,
    unread: state.unread,
    boldName: state.unread,
    showPrimaryStar: bot.isPrimary,
    inlineText,
    inlineTone,
    statusMark,
    accessibilityLabel
  }
}

/** Left-swipe pills: Pin, Read, Hide (Show when hidden) for ordinary bots; primary keeps Read/Unread. */
export function rosterSwipeActionSpecs(bot: Bot): RosterSwipeSpec[] {
  const unread = isUnread(bot)
  const readAction: RosterSwipeSpec = {
    id: 'toggle-unread',
    label: unread ? 'Read' : 'Unread',
    accessibilityLabel: unreadActionLabel(unread),
    tone: 'primary'
  }
  if (!canArrange(bot)) return [readAction]
  const pinLabel = pinActionLabel(bot.prefs.pinned)
  const visLabel = visibilityActionLabel(bot.prefs.hidden)
  return [
    { id: 'toggle-pin', label: pinLabel, accessibilityLabel: pinLabel, tone: 'ink' },
    readAction,
    { id: 'toggle-hide', label: visLabel, accessibilityLabel: visLabel, tone: 'muted' }
  ]
}

/** Bot menu items using the exact shared web labels from BOT_MENU_LABELS. */
export function rosterMenuActions(bot: Bot, hasPrimaryCandidates: boolean): RosterMenuActionSpec[] {
  const unread = isUnread(bot)
  const items: RosterMenuActionSpec[] = []
  if (canArrange(bot)) {
    items.push({ id: 'pin', label: pinActionLabel(bot.prefs.pinned) })
    items.push({ id: 'move-section', label: BOT_MENU_LABELS.moveToSection })
  }
  items.push({ id: 'toggle-unread', label: unreadActionLabel(unread) })
  items.push({ id: 'name-and-avatar', label: BOT_MENU_LABELS.nameAndAvatar })
  items.push({
    id: 'primary',
    label: bot.isPrimary ? BOT_MENU_LABELS.changePrimaryBot : BOT_MENU_LABELS.makePrimary,
    ...(bot.isPrimary ? { disabled: !hasPrimaryCandidates } : {})
  })
  if (canArrange(bot)) items.push({ id: 'hide', label: visibilityActionLabel(bot.prefs.hidden) })
  if (canDelete(bot)) items.push({ id: 'delete', label: BOT_MENU_LABELS.delete, destructive: true })
  return items
}

/** Tile badge signals matching web AvatarMarks: top-right unread dot, bottom-right working spinner or primary star. */
export function tileSignal(bot: Bot): { unread: boolean; working: boolean; showPrimaryStar: boolean } {
  const state = rowState(bot)
  const working = state.tone === 'working'
  return { unread: state.unread, working, showPrimaryStar: bot.isPrimary && !working }
}
