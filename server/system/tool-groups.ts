/** Temporary groups: one tool whose action field covers starting, the next point, attaching files, closing and reading
 *  status, because every tool costs a listing line in every turn. It calls `GroupService`, the same records as the
 *  screens' `threads.list`, `threads.open` and `threads.cancel`. Status calls are reads and leave no change record. */
import { GroupInput } from '../../shared/thread-schema'
import { actionTool, type McpTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'

export function groupTools({ delegation: { groups } }: SystemDeps): McpTool[] {
  const tool = actionTool(
    'lilbot_group',
    'Work through a task with 2 to 4 other bots in a temporary group: you lead, they reply to each point in parallel, then you close it with an outcome. action start (purpose, members, text: first point, to, files), say (next point), close (text: outcome, keep: files), status; members attach files to their reply. Replies come back as new turns: never poll.',
    GroupInput,
    (caller, input) => groups.act(caller, input)
  )
  return [{ ...tool, readOnly: (args: GroupInput) => args.action === 'status' }]
}
