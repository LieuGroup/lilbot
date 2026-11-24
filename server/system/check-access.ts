/** What a check session may do with LilBot's own tools (#174): read, and give its verdict. Every changing call is refused,
 *  and so are reading memory (`lilbot_memory_list`, `lilbot_memory_recall`) and searching past conversations (`lilbot_history_search`),
 *  which could tell it what its owner meant to have done. MCP calls carry
 *  no session, so while a check of the calling bot is under way a call is matched to the tool starts the engine reported
 *  (`CallingChats.gate`: exact request id or arguments first, falling back after a grace window only when strictly one
 *  unmatched start exists for a call without request id); one that cannot be placed is refused (it fails closed).
 *  Calls of a bot that checks nothing are never held. */
import { AMBIGUOUS, AMBIGUOUS_MATCH, type CallingChats, NOT_SEEN } from '../threads/calling-chats'
import type { WebhookCallers } from '../webhooks/webhook-callers'
import type { CheckSessions } from '../work/check-sessions'
import type { McpTool, ToolCallContext } from './mcp-tool'
import { refusalFor, runRefusalForChat } from './run-access'

const CHECK_REFUSED_READS = new Set(['lilbot_memory_list', 'lilbot_memory_recall', 'lilbot_history_search', 'lilbot_computers_list', 'lilbot_computer_request_read'])
const IN_CHECK = 'This session is a check: LilBot lets it read and give its verdict (lilbot_work with verdict), nothing else.'
const REVIEW_ALLOWED = new Set(['lilbot_memory_recall', 'lilbot_memory_save', 'lilbot_memory_forget'])
const REVIEW_CONTEXT_TOOLS = new Set(['lilbot_memory_save', 'lilbot_memory_forget'])
const IN_REVIEW =
  'This session is a memory review: LilBot lets it only recall, save, or forget memory (lilbot_memory_recall, lilbot_memory_save, lilbot_memory_forget), nothing else.'

export interface ReviewSessions {
  reviewing: (botId: string) => boolean
  isReview: (chatId: string) => boolean
}

export interface SessionGateResult {
  refused: string | null
  context?: ToolCallContext
}

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

type GateCallers = Pick<WebhookCallers, 'hasRuns' | 'forChat'> & Partial<Pick<WebhookCallers, 'unplacedCapabilities'>>
const unplacedOf = (callers: GateCallers, botId: string) => (callers.unplacedCapabilities ? callers.unplacedCapabilities(botId) : callers.hasRuns(botId) ? [] : null)

/** Single-placement gate for outside MCP tools: places the call once in `CallingChats` and applies both webhook and check rules. */
export function serviceSessionRefusal(callers: GateCallers, sessions: Pick<CheckSessions, 'checking' | 'isCheck'>, calls: Pick<CallingChats, 'gate'>) {
  return async (botId: string, name: string, raw: unknown): Promise<string | null> => {
    const unplaced = unplacedOf(callers, botId)
    const hasHook = unplaced !== null
    const checking = sessions.checking(botId)
    if (!hasHook && !checking) return null
    const chatId = await calls.gate(botId, name, raw, chat => (hasHook && callers.forChat(botId, chat) !== null) || (checking && sessions.isCheck(botId, chat)))
    if (chatId === AMBIGUOUS_MATCH) return AMBIGUOUS
    if (hasHook) {
      if (chatId === null) console.warn(`[webhook-session] ${name}: no tool start seen; treated as a webhook run's call`)
      const hook = refusalFor(chatId === null ? unplaced : callers.forChat(botId, chatId), name, [])
      if (hook) return hook
    }
    return checkChatRefusal(sessions, botId, name, chatId)
  }
}

/** Single-placement gate for LilBot's own MCP server: places each restricted or review-active call once, applies check,
 *  webhook and review rules, and returns review context for `lilbot_memory_save`/`lilbot_memory_forget` only while a
 *  review runs for that bot. Ordinary chats never enter the placement gate. */
export function systemSessionGate(
  tools: McpTool[],
  sessions: Pick<CheckSessions, 'checking' | 'isCheck'>,
  callers: GateCallers,
  calls: Pick<CallingChats, 'gate'> & Partial<Pick<CallingChats, 'dropClaim'>>,
  beyondOwn: (botId: string, tool: string, args: unknown) => boolean,
  t3Enabled = false,
  reviews?: ReviewSessions
) {
  const byName = new Map(tools.map(tool => [tool.name, tool]))
  return async (botId: string, name: string, raw: unknown): Promise<SessionGateResult> => {
    const tool = byName.get(name)
    const args = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
    const reads = tool ? (typeof tool.readOnly === 'function' ? tool.readOnly(args) : tool.readOnly) : false
    const needCheck = !!tool && sessions.checking(botId) && !((reads && !CHECK_REFUSED_READS.has(name)) || (name === 'lilbot_work' && args.verdict !== undefined))
    const unplaced = unplacedOf(callers, botId)
    const needHook = unplaced !== null && runRefusalForChat(unplaced, botId, name, raw, beyondOwn, t3Enabled) !== null
    const reviewing = !!tool && !!reviews?.reviewing(botId)
    const needReviewBlock = reviewing && !REVIEW_ALLOWED.has(name)
    const needReviewContext = reviewing && REVIEW_CONTEXT_TOOLS.has(name)
    if (!needCheck && !needHook && !needReviewBlock && !needReviewContext) return { refused: null }
    const chatId = await calls.gate(
      botId,
      name,
      raw,
      chat => (needCheck && sessions.isCheck(botId, chat)) || (needHook && callers.forChat(botId, chat) !== null) || (reviewing && reviews!.isReview(chat))
    )
    if (chatId === AMBIGUOUS_MATCH) return { refused: AMBIGUOUS }
    if (needCheck) {
      const check = checkChatRefusal(sessions, botId, name, chatId)
      if (check) {
        if (chatId) calls.dropClaim?.(botId, name, chatId)
        return { refused: check }
      }
    }
    if (needHook) {
      if (chatId === null) console.warn(`[webhook-session] ${name}: no tool start seen; treated as a webhook run's call`)
      const refused = runRefusalForChat(chatId === null ? unplaced : callers.forChat(botId, chatId), botId, name, raw, beyondOwn, t3Enabled)
      if (refused) {
        if (chatId) calls.dropClaim?.(botId, name, chatId)
        return { refused }
      }
    }
    if (needReviewBlock) {
      if (chatId === null) {
        console.warn(`[review-session] ${name}: no tool start seen while a review runs; refused`)
        return { refused: NOT_SEEN }
      }
      if (reviews!.isReview(chatId)) {
        console.warn(`[review-session] ${name} refused in a memory review session`)
        calls.dropClaim?.(botId, name, chatId)
        return { refused: IN_REVIEW }
      }
    }
    if (needReviewContext) {
      if (chatId === null) {
        console.warn(`[review-session] ${name}: no tool start seen while a review runs; refused`)
        return { refused: NOT_SEEN }
      }
      return { refused: null, context: { review: reviews!.isReview(chatId), chatId } }
    }
    return { refused: null }
  }
}

export function systemSessionRefusal(
  tools: McpTool[],
  sessions: Pick<CheckSessions, 'checking' | 'isCheck'>,
  callers: GateCallers,
  calls: Pick<CallingChats, 'gate'> & Partial<Pick<CallingChats, 'dropClaim'>>,
  beyondOwn: (botId: string, tool: string, args: unknown) => boolean,
  t3Enabled = false,
  reviews?: ReviewSessions
) {
  const gate = systemSessionGate(tools, sessions, callers, calls, beyondOwn, t3Enabled, reviews)
  return async (botId: string, name: string, raw: unknown): Promise<string | null> => (await gate(botId, name, raw)).refused
}
