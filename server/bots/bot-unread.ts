import type { ActivityService } from '../activity/activity-service'
import type { BotService } from './bot-service'

/** Marks a bot's conversation read or unread. The app's read marker and the system MCP tool both call this. */
export async function setUnread(bots: Pick<BotService, 'getBot'>, activity: ActivityService | undefined, botId: string, unread: boolean) {
  await bots.getBot(botId)
  activity?.setUnread(botId, unread)
  return { ok: true as const }
}
