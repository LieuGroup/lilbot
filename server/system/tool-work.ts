/** The work board's two tools: one to open and report, one to read. Both call `WorkService`, the same records Oscar's
 *  `work.list` and `work.open` read. Few tools and short text: every tool costs tokens on every turn. */
import { WorkInput, WorkReadInput } from '../../shared/work-schema'
import { actionTool, type McpTool, readTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'

export function workTools({ work }: SystemDeps): McpTool[] {
  return [
    actionTool(
      'lilbot_work',
      'Open a work item for work beyond a reply (no itemId; title, done), or report on your own item (itemId): done definition, evidence of the real result and status in one call. Status needs_oscar takes one question; done or failed a result; dropped a reason. Done needs a definition and evidence unless level 0.',
      WorkInput,
      (caller, input) => work.act(caller, input)
    ),
    readTool('lilbot_work_list', "List work items: yours, every bot's (mine false), or one in full with its evidence.", WorkReadInput, (caller, input) => work.read(caller, input))
  ]
}
