/** Settings tools: the delete dialog's defaults (`bots.deleteDefaults.get` and `.set`). Deleting a bot is not a tool. */

import { z } from 'zod'
import { BotDeleteDefaults } from '../../shared/bot-delete-schema'
import { actionTool, type McpTool, readTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'

export function settingsTools({ bots }: SystemDeps): McpTool[] {
  return [
    readTool('lilbot_delete_defaults_get', 'What the delete-bot dialog starts from: archive or delete files, forget or keep private memories.', z.object({}), async () =>
      bots.deleteDefaults()
    ),
    actionTool('lilbot_delete_defaults_set', 'Change what the delete-bot dialog starts from. It does not delete anything.', BotDeleteDefaults, async (_caller, input) =>
      bots.setDeleteDefaults(input)
    )
  ]
}
