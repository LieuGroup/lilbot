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
import type { SurfaceKind } from '../duo/layout'
import { formatLastMessagePreview, formatRosterTime, hasActiveLiveRowState, type RosterTimeOptions } from './roster-preview'

export type RowStatusMark = 'working' | 'finished' | 'failed' | null
export type InlineTextTone = 'destructive' | 'foreground' | 'muted'

export interface RosterRowDisplay {
  tone: RowTone
  unread: boolean
  boldName: boolean
  showPrimaryStar: boolean
  inlineText: string
  /** Never truncated end of `inlineText` ("· 2 tasks", #316). */
  inlineTail: string | null
  inlineTone: InlineTextTone
  timeText: string | null
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
  id: 'details' | 'pin' | 'move-section' | 'toggle-unread' | 'name-and-avatar' | 'primary' | 'hide' | 'delete'
  label: string
  destructive?: boolean
  disabled?: boolean
}

export interface DetachedTabTriggerSpec {
  action: 'new-bot' | 'new-session'
  sf: 'plus' | 'square.and.pencil'
  label: string
  testID: string
}

/** Detached native tab-bar trigger spec (`role="search"`):
 *  - iPad (`pad`): omitted (`null`) so the top tab capsule stays `Bots | Settings` only (New session lives in split Chat header).
 *  - Unfolded Duo Landscape (`duo-unfolded-landscape`) and Folded Duo Chat (`duo-folded` + `chatFocused`): `New session`.
 *  - Standard iPhone (`phone`), Folded Duo Roster, and Duo Unfolded Portrait: `+` (`New bot`). */
export function detachedTabTriggerSpec(input: { surface: SurfaceKind; chatFocused: boolean }): DetachedTabTriggerSpec | null {
  if (input.surface === 'pad') return null
  if (input.surface === 'duo-unfolded-landscape' || (input.surface === 'duo-folded' && input.chatFocused)) {
    return { action: 'new-session', sf: 'square.and.pencil', label: 'New session', testID: 'new-session-trigger' }
  }
  return { action: 'new-bot', sf: 'plus', label: 'New bot', testID: 'new-bot-trigger' }
}

/** Returns true when Expo Router segments are on the Bots tab rather than Settings. */
export function isBotsTabSegments(segments: readonly string[]): boolean {
  if (segments.includes('settings') || segments.includes('(settings)')) return false
  return segments.includes('(bots)') || segments.length <= 1
}

/** Split-mode New session orb only fires when connected, on the Bots tab, and the selected bot's chat is ready. */
export function canStartNewSession(state: {
  connected: boolean
  ready: boolean
  botsTabActive: boolean
  selectedId: string | null
}): boolean {
  return Boolean(state.connected && state.ready && state.botsTabActive && state.selectedId)
}

/** Value-compares every Bot field rendered or acted on by RosterRow so fresh bots.list payloads skip unchanged rows. */
export function sameRosterBotDisplay(a: Bot, b: Bot): boolean {
  if (a === b) return true
  if (
    a.id !== b.id ||
    a.name !== b.name ||
    a.function !== b.function ||
    a.isPrimary !== b.isPrimary ||
    a.runnable !== b.runnable ||
    a.runtimePending !== b.runtimePending ||
    a.prefs.pinned !== b.prefs.pinned ||
    a.prefs.hidden !== b.prefs.hidden ||
    a.prefs.sectionId !== b.prefs.sectionId ||
    a.prefs.avatar.shape !== b.prefs.avatar.shape ||
    a.prefs.avatar.color !== b.prefs.avatar.color ||
    a.prefs.avatar.faceColor !== b.prefs.avatar.faceColor ||
    a.activity?.status !== b.activity?.status ||
    a.activity?.text !== b.activity?.text ||
    a.activity?.unread !== b.activity?.unread ||
    a.workingFor?.name !== b.workingFor?.name ||
    a.workers?.count !== b.workers?.count ||
    a.workers?.activity !== b.workers?.activity ||
    a.lastMessage?.from !== b.lastMessage?.from ||
    a.lastMessage?.text !== b.lastMessage?.text ||
    a.lastMessage?.at !== b.lastMessage?.at
  ) {
    return false
  }
  const ag = a.groups ?? []
  const bg = b.groups ?? []
  if (ag.length !== bg.length) return false
  for (let i = 0; i < ag.length; i++) {
    if (ag[i].id !== bg[i].id || ag[i].leading !== bg[i].leading || ag[i].activity !== bg[i].activity) return false
  }
  const senders = (bot: Bot) => (bot.tasksFor ?? []).map(task => `${task.botId}:${task.name}`).join('|')
  return senders(a) === senders(b)
}

/** Maps shared rowState(bot) + optional `bot.lastMessage` into two-line Roster row display: live status wins
 *  over `lastMessage` (with time suppressed whenever line 2 is not showing `lastMessage`). */
export function rosterRowDisplay(bot: Bot, timeOptions?: RosterTimeOptions): RosterRowDisplay {
  const state = rowState(bot)
  const previewText = formatLastMessagePreview(bot.lastMessage)
  const showingLastMessage = !hasActiveLiveRowState(bot, state.tone) && previewText !== null
  const inlineText = showingLastMessage ? previewText : state.text
  const timeText = showingLastMessage && bot.lastMessage ? formatRosterTime(bot.lastMessage.at, timeOptions) : null
  const spokenTime = showingLastMessage && bot.lastMessage ? formatRosterTime(bot.lastMessage.at, { ...timeOptions, weekday: 'long' }) : null
  const spokenStatus = state.tone === 'working' && !/\bworking\b/i.test(inlineText) ? 'Working' : ''
  const accessibilityLabel = [bot.name, bot.isPrimary ? 'Primary bot' : '', spokenStatus, inlineText, spokenTime ?? '', state.unread ? 'Unread' : ''].filter(Boolean).join(', ')

  let inlineTone: InlineTextTone = 'muted'
  if (state.tone === 'failed') {
    inlineTone = 'destructive'
  } else if (state.unread || state.tone === 'waiting') {
    inlineTone = 'foreground'
  }

  const statusMark: RowStatusMark = state.tone === 'working' || state.tone === 'failed' || state.tone === 'finished' ? state.tone : null

  return {
    tone: state.tone,
    unread: state.unread,
    boldName: state.unread,
    showPrimaryStar: bot.isPrimary,
    inlineText,
    inlineTail: showingLastMessage ? null : (state.tail ?? null),
    inlineTone,
    timeText,
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
