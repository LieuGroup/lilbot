/** The goal tool: propose a goal from Oscar's words, a new version or a change, and report a review, in one tool. Goals are
 *  read with `lilbot_work_list`, so goals add one listing line to every turn. */
import { GoalInput } from '../../shared/goal-schema'
import { actionTool, type McpTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'

export function goalTools({ goals }: SystemDeps): McpTool[] {
  return [
    actionTool(
      'lilbot_goal',
      'Propose a goal agreement and target for Oscar, or report a review. propose: text, agreement, target (with live baseline); with goalId, revise or change (why). progress: value, did, evidence. Guide: goals.',
      GoalInput,
      (caller, input) => goals.act(caller, input)
    )
  ]
}
