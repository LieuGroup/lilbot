/** What a check session may do with LilBot's own tools (#174): read, and give its verdict. Every changing call is refused,
 *  and so is reading memory (`lilbot_memory_list`), which could tell it what its owner meant to have done. MCP calls carry
 *  no session, so while a check of the calling bot is under way a call is matched to the tool starts the engine reported
 *  (`CallingChats.gate`: exact request id or arguments first, falling back after a grace window only when strictly one
 *  unmatched start exists for a call without request id); one that cannot be placed is refused (it fails closed).
 *  Calls of a bot that checks nothing are never held. */
import { type CallingChats, NOT_SEEN } from '../threads/calling-chats'
import type { WebhookCallers } from '../webhooks/webhook-callers'
import type { CheckSessions } from '../work/check-sessions'
import type { McpTool } from './mcp-tool'
import { needsWebhookCheck, refusalFor, runRefusalForChat } from './run-access'

const READS_MEMORY = new Set(['lilbot_memory_list'])
const IN_CHECK = 'This session is a check: LilBot lets it read and give its verdict (lilbot_work with verdict), nothing else.'

function checkChatRefusal(sessions: Pick<CheckSessions, 'checking' | 'isCheck'>, botId: string, name: string, chatId: string | null): string | null {
  if (!sessions.checking(botId)) return null
  if (chatId === null) {
    console.warn(`[check-session] ${name}: no tool start seen while a check runs; refused`)
    return NOT_SEEN
  }
  if (sessions.isCheck(botId, chatId)) {
    console.warn(`[check-session] ${name} refused in a check session`)
    return IN_CHECK
  }
  return null
}

/** Single-placement gate for outside MCP tools: places the call once in `CallingChats` and applies both webhook and check rules. */
export function serviceSessionRefusal(
  callers: Pick<WebhookCallers, 'hasRuns' | 'forChat'>,
  sessions: Pick<CheckSessions, 'checking' | 'isCheck'>,
  calls: Pick<CallingChats, 'gate'>
) {
  return async (botId: string, name: string, raw: unknown): Promise<string | null> => {
    const hasHook = callers.hasRuns(botId)
    const checking = sessions.checking(botId)
    if (!hasHook && !checking) return null
    const chatId = await calls.gate(botId, name, raw, chat => (hasHook && callers.forChat(botId, chat) !== null) || (checking && sessions.isCheck(botId, chat)))
    if (hasHook) {
      if (chatId === null) console.warn(`[webhook-session] ${name}: no tool start seen; treated as a webhook run's call`)
      const hook = refusalFor(callers.forChat(botId, chatId ?? undefined), name, [])
      if (hook) return hook
    }
    return checkChatRefusal(sessions, botId, name, chatId)
  }
}

/** Single-placement gate for LilBot's own MCP server: places each restricted call once and applies check and webhook rules. */
export function systemSessionRefusal(
  tools: McpTool[],
  sessions: Pick<CheckSessions, 'checking' | 'isCheck'>,
  callers: Pick<WebhookCallers, 'hasRuns' | 'forChat'>,
  calls: Pick<CallingChats, 'gate'>,
  beyondOwn: (botId: string, tool: string, args: unknown) => boolean,
  t3Enabled = false
) {
  const byName = new Map(tools.map(tool => [tool.name, tool]))
  return async (botId: string, name: string, raw: unknown): Promise<string | null> => {
    const tool = byName.get(name)
    const args = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
    const reads = tool ? (typeof tool.readOnly === 'function' ? tool.readOnly(args) : tool.readOnly) : false
    const needCheck = !!tool && sessions.checking(botId) && !((reads && !READS_MEMORY.has(name)) || (name === 'lilbot_work' && args.verdict !== undefined))
    const needHook = callers.hasRuns(botId) && needsWebhookCheck(botId, name, raw, beyondOwn)
    if (!needCheck && !needHook) return null
    const chatId = await calls.gate(botId, name, raw, chat => (needCheck && sessions.isCheck(botId, chat)) || (needHook && callers.forChat(botId, chat) !== null))
    if (needCheck) {
      const check = checkChatRefusal(sessions, botId, name, chatId)
      if (check) return check
    }
    if (!needHook) return null
    if (chatId === null) console.warn(`[webhook-session] ${name}: no tool start seen; treated as a webhook run's call`)
    return runRefusalForChat(callers.forChat(botId, chatId ?? undefined), botId, name, raw, beyondOwn, t3Enabled)
  }
}
