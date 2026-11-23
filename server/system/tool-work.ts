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
      'Open a work item, report status/evidence, or give a check verdict. Open (no itemId): title, kind, done. Report (itemId): done, evidence, status (needs_oscar: question; done/failed: result; dropped: reason). Done needs done+evidence unless level 0. Checker: pass verdict.',
      WorkInput,
      async (caller, input) => fenceRunText(await work.act(caller, input), work.host.isNarrowedOrigin)
    ),
    readTool(
      'lilbot_work_list',
      "List work items or goals: yours, every bot's (mine false), or one in full with its evidence.",
      WorkReadInput.extend(GoalReadInput.shape),
      async (caller, input) => fenceRunText(await (input.goals || input.goalId ? goals.read(caller, input) : work.read(caller, input)), work.host.isNarrowedOrigin)
    )
  ]
}
