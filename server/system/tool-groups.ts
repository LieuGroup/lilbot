/** Temporary groups: one tool whose action field covers starting, the next point, attaching files, closing and reading
 *  status, because every tool costs a listing line in every turn. It calls `GroupService`, the same records as the
 *  screens' `threads.list`, `threads.open` and `threads.cancel`. Status calls are reads and leave no change record. */
import { GroupInput } from '../../shared/thread-schema'
import { actionTool, type McpTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'

export function groupTools({ delegation: { groups } }: SystemDeps): McpTool[] {
  const tool = actionTool(
    'lilbot_group',
    'Lead a temporary group of 2-4 bots replying in parallel, then close it (call lilbot_bots_list first to look up the roster). action: start (purpose, members, text, to, files), say (next point), attach (member files), close (text outcome, keep files), status. Replies arrive as new turns: never poll.',
    GroupInput,
    (caller, input, raw, ctx) => groups.act(caller, input, raw ?? input, ctx)
  )
  return [{ ...tool, readOnly: (args: GroupInput) => args.action === 'status' }]
}
