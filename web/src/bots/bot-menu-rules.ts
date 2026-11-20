/** What the bot menu offers for a bot. Pure, so the rules can be tested without a browser. */
import type { Bot } from '../../../shared/bot-schema'

/** The primary bot is always the first tile, so pinning, moving it to a section or hiding it
 *  would change nothing the user can see. */
export const canArrange = (bot: Bot) => !bot.isPrimary

/** The primary bot and the engine's own default bot cannot be deleted (the server refuses). */
export const canDelete = (bot: Bot) => !bot.isPrimary && !bot.isDefault

/** The bots the primary mark can move to, in roster order. */
export const primaryCandidates = (bots: Bot[]) => bots.filter(bot => !bot.isPrimary)

export const isUnread = (bot: Bot) => bot.activity?.unread ?? false
