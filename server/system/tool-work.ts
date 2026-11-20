/** The work board's two tools: one to open and report, one to read. Both call `WorkService`, the same records Oscar's
 *  `work.list` and `work.open` read. Few tools and short text: every tool costs tokens on every turn. */
import { WorkInput, WorkReadInput } from '../../shared/work-schema'
import { actionTool, type McpTool, readTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'

export function workTools({ work }: SystemDeps): McpTool[] {
  return [
    actionTool(
      'lilbot_work',
      'Your work board. No itemId: open an item (title, done). With itemId: report on your item, all in one call: done, evidence of the real result, status (needs_oscar with one question; done or failed with result; dropped with reason). Done needs done and evidence unless level 0.',
      WorkInput,
      (caller, input) => work.act(caller, input)
    ),
    readTool('lilbot_work_list', "Work items: yours, every bot's (mine false), or one in full with its evidence.", WorkReadInput, (caller, input) => work.read(caller, input))
  ]
}
