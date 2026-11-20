/** The goal tool: propose a goal from Oscar's words, a new version or a change, and report a review, in one tool. Goals are
 *  read with `lilbot_work_list`, so goals add one listing line to every turn. */
import { GoalInput } from '../../shared/goal-schema'
import { actionTool, type McpTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'

export function goalTools({ goals }: SystemDeps): McpTool[] {
  return [
    actionTool(
      'lilbot_goal',
      "When Oscar gives you an outcome to reach, propose a goal agreement and a measured target for him to agree, then report reviews. propose: Oscar's words (text), the agreement (what you do alone, need from him, cannot influence) and the target with a baseline you read from its source now; with goalId, a new version or a change (why). progress: on an agreed goal, the value you read now, did and evidence. Guide topic goals.",
      GoalInput,
      (caller, input) => goals.act(caller, input)
    )
  ]
}
