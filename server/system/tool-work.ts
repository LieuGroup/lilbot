/** The work board's two tools: one to open and report (and give a check's verdict), one to read items or goals. They call `WorkService` and
 *  `GoalService`, the same records Oscar's `work.list`, `work.open` and `goals.open` read. Few tools and short text: every tool costs tokens on every turn. */
import { GoalReadInput } from '../../shared/goal-schema'
import { WorkInput, WorkReadInput } from '../../shared/work-schema'
import { fenceRunText } from '../work/webhook-items'
import { actionTool, type McpTool, readTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'

export function workTools({ work, goals }: SystemDeps): McpTool[] {
  return [
    actionTool(
      'lilbot_work',
      'Open a work item for work beyond a reply (no itemId; title, kind, done), or report on your own item (itemId): done definition, evidence of the real result and status in one call. Status needs_oscar takes one question; done or failed a result; dropped a reason. Done needs a definition and evidence unless level 0; at level 2 a bot LilBot picks checks it first, at 3 Oscar. When LilBot asks you to check an item, give your verdict here.',
      WorkInput,
      async (caller, input) => fenceRunText(await work.act(caller, input))
    ),
    readTool(
      'lilbot_work_list',
      "List work items or goals: yours, every bot's (mine false), or one in full with its evidence.",
      WorkReadInput.extend(GoalReadInput.shape),
      async (caller, input) => fenceRunText(await (input.goals || input.goalId ? goals.read(caller, input) : work.read(caller, input)))
    )
  ]
}
