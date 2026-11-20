/** Roster tools: what Oscar does in the bot list. Each calls the function the screen uses
 *  (`bots.setPrefs`, `sections.create`, `activity.setUnread`). */
import { z } from 'zod'
import { BotPrefsInput, sectionName } from '../../shared/bot-schema'
import { setUnread } from '../bots/bot-unread'
import { actionTool, type McpTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'

export function rosterTools({ bots, activity }: SystemDeps): McpTool[] {
  return [
    actionTool(
      'lilbot_roster_set',
      'Pin or unpin a bot, hide or show it, or move it to a section (sectionId null removes it from its section). Only what you give changes.',
      BotPrefsInput.omit({ avatar: true }),
      async (_caller, input) => {
        const { id, name, prefs } = await bots.setPrefs(input)
        const { avatar, ...rest } = prefs
        return { id, name, ...rest }
      }
    ),
    actionTool('lilbot_section_create', 'Create a roster section. Move bots into it with lilbot_roster_set.', z.object({ name: sectionName }), async (_caller, { name }) =>
      bots.createSection(name)
    ),
    actionTool('lilbot_unread_set', "Mark a bot's conversation read or unread.", z.object({ botId: z.string().min(1), unread: z.boolean() }), (_caller, { botId, unread }) =>
      setUnread(bots, activity, botId, unread)
    )
  ]
}
