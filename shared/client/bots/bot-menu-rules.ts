/** What the bot menu offers for a bot and its exact shared labels. Pure, so web and iOS never drift. */
import type { Bot } from '../../bot-schema'

/** Exact bot menu labels shared by the web and iOS clients. */
export const BOT_MENU_LABELS = {
  pin: 'Pin',
  unpin: 'Unpin',
  moveToSection: 'Move to section',
  noSection: 'No section',
  newSection: 'New section…',
  markAsRead: 'Mark as read',
  markAsUnread: 'Mark as unread',
  nameAndAvatar: 'Name and avatar',
  makePrimary: 'Make primary',
  changePrimaryBot: 'Change primary bot',
  hide: 'Hide',
  show: 'Show',
  delete: 'Delete…'
} as const

/** The primary bot is always the first tile, so pinning, moving it to a section or hiding it
 *  would change nothing the user can see. */
export const canArrange = (bot: Bot) => !bot.isPrimary

/** The primary bot cannot be deleted until another bot is chosen as primary (the server refuses). */
export const canDelete = (bot: Bot) => !bot.isPrimary

/** The bots the primary mark can move to, in roster order. */
export const primaryCandidates = (bots: Bot[]) => bots.filter(bot => !bot.isPrimary)

export const isUnread = (bot: Bot) => bot.activity?.unread ?? false

export const pinActionLabel = (pinned: boolean) => (pinned ? BOT_MENU_LABELS.unpin : BOT_MENU_LABELS.pin)
export const unreadActionLabel = (unread: boolean) => (unread ? BOT_MENU_LABELS.markAsRead : BOT_MENU_LABELS.markAsUnread)
export const visibilityActionLabel = (hidden: boolean) => (hidden ? BOT_MENU_LABELS.show : BOT_MENU_LABELS.hide)
