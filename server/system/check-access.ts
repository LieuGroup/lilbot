/** What a check session may do with LilBot's own tools (#174): read, and give its verdict. Every changing call is refused,
 *  and so is reading memory (`lilbot_memory_list`), which could tell it what its owner meant to have done. MCP calls carry
 *  no session, so while a check of the calling bot is under way a call is matched to the tool starts the engine reported
 *  (`CallingChats.starts`) by its request id or its arguments; one that cannot be matched in time is refused (it fails
 *  closed). Calls of a bot that checks nothing are never held. */
import { argsKey, type CallingChats, NOT_SEEN } from '../threads/calling-chats'
import type { CheckSessions } from '../work/check-sessions'
import type { McpTool } from './mcp-tool'

/** How long before its request a call's start counts (as for `CallingChats.find`). */
const FRESH_MS = 15_000
const READS_MEMORY = new Set(['lilbot_memory_list'])
const IN_CHECK = 'This session is a check: LilBot lets it read and give its verdict (lilbot_work with verdict), nothing else.'

export function checkRefusal(tools: McpTool[], sessions: Pick<CheckSessions, 'checking' | 'isCheck'>, calls: Pick<CallingChats, 'starts' | 'waitMs'>) {
  const byName = new Map(tools.map(tool => [tool.name, tool]))
  return async (botId: string, name: string, raw: unknown): Promise<string | null> => {
    const tool = byName.get(name)
    if (!tool || !sessions.checking(botId)) return null
    const args = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
    const reads = typeof tool.readOnly === 'function' ? tool.readOnly(args) : tool.readOnly
    if ((reads && !READS_MEMORY.has(name)) || (name === 'lilbot_work' && args.verdict !== undefined)) return null
    const key = argsKey(args)
    const requestId = typeof args.requestId === 'string' ? args.requestId : null
    const asked = Date.now()
    for (;;) {
      const own = calls.starts(botId, name, asked - FRESH_MS).filter(start => start.args === key || (requestId !== null && start.requestId === requestId))
      if (own.some(start => sessions.isCheck(botId, start.chatId))) {
        console.warn(`[check-session] ${name} refused in a check session`)
        return IN_CHECK
      }
      if (own.length) return null
      if (Date.now() - asked >= calls.waitMs) {
        console.warn(`[check-session] ${name}: no tool start seen while a check runs; refused`)
        return NOT_SEEN
      }
      await Bun.sleep(50)
    }
  }
}
