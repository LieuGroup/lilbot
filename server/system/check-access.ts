/** What a check session may do with LilBot's own tools (#174): read, and give its verdict. Every changing call is refused,
 *  and so is reading memory (`lilbot_memory_list`), which could tell it what its owner meant to have done. MCP calls carry
 *  no session, so while a check of the calling bot is under way a call is matched to the tool starts the engine reported
 *  (`CallingChats.gate`: exact request id or arguments first, falling back after a grace window only when strictly one
 *  unmatched start exists for a call without request id); one that cannot be placed is refused (it fails closed).
 *  Calls of a bot that checks nothing are never held. */
import { AMBIGUOUS, type CallingChats, NOT_SEEN } from '../threads/calling-chats'
import type { WebhookCallers } from '../webhooks/webhook-callers'
import type { CheckSessions } from '../work/check-sessions'
import type { McpTool } from './mcp-tool'
import { refusalFor, runRefusalForChat } from './run-access'

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

type GateCallers = Pick<WebhookCallers, 'placeCall' | 'unplacedCapabilities' | 'forChat'>
type GateCalls = Partial<Pick<CallingChats, 'dropClaim'>>

/** Single-placement gate for outside MCP tools: delegates placement to `callers.placeCall` and applies webhook and check rules. */
export function serviceSessionRefusal(callers: Pick<WebhookCallers, 'placeCall'>, sessions: Pick<CheckSessions, 'checking' | 'isCheck'>, _calls?: unknown) {
  return async (botId: string, name: string, raw: unknown): Promise<string | null> => {
    const checking = sessions.checking(botId)
    const placed = await callers.placeCall(botId, name, raw, {
      slot: 'gated',
      forceGate: checking,
      prefer: checking ? chat => sessions.isCheck(botId, chat) : undefined
    })
    if (placed.kind === 'ambiguous') return AMBIGUOUS
    if (placed.capabilities !== null) {
      if (placed.kind === 'unplaced') console.warn(`[webhook-session] ${name}: no tool start seen; treated as a webhook run's call`)
      const hook = refusalFor(placed.capabilities, name, [])
      if (hook) return hook
    }
    return checkChatRefusal(sessions, botId, name, placed.kind === 'placed' ? placed.chatId : null)
  }
}

/** Single-placement gate for LilBot's own MCP server: delegates placement to `callers.placeCall` and applies check and webhook rules. */
export function systemSessionRefusal(
  tools: McpTool[],
  sessions: Pick<CheckSessions, 'checking' | 'isCheck'>,
  callers: GateCallers,
  calls: GateCalls,
  beyondOwn: (botId: string, tool: string, args: unknown) => boolean,
  t3Enabled = false
) {
  const byName = new Map(tools.map(tool => [tool.name, tool]))
  return async (botId: string, name: string, raw: unknown): Promise<string | null> => {
    const tool = byName.get(name)
    const args = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
    const reads = tool ? (typeof tool.readOnly === 'function' ? tool.readOnly(args) : tool.readOnly) : false
    const needCheck = !!tool && sessions.checking(botId) && !((reads && !READS_MEMORY.has(name)) || (name === 'lilbot_work' && args.verdict !== undefined))
    const unplaced = callers.unplacedCapabilities(botId)
    const liveAllowed = unplaced !== null && runRefusalForChat(unplaced, botId, name, raw, beyondOwn, t3Enabled) === null
    const canRefuse = runRefusalForChat([], botId, name, raw, beyondOwn, t3Enabled) !== null
    if (!needCheck && !canRefuse) return null
    const placed = await callers.placeCall(botId, name, raw, {
      slot: 'gated',
      forceGate: needCheck,
      liveAllowed,
      prefer: needCheck ? chat => sessions.isCheck(botId, chat) : undefined,
      limitedPrefer: chat => {
        const caps = callers.forChat(botId, chat)
        return caps !== null && runRefusalForChat(caps, botId, name, raw, beyondOwn, t3Enabled) !== null
      }
    })
    if (placed.kind === 'ambiguous') return AMBIGUOUS
    const chatId = placed.kind === 'placed' ? placed.chatId : null
    if (needCheck) {
      const check = checkChatRefusal(sessions, botId, name, chatId)
      if (check) {
        if (chatId) calls.dropClaim?.(botId, name, chatId)
        return check
      }
    }
    if (placed.capabilities === null) return null
    if (placed.kind === 'unplaced') console.warn(`[webhook-session] ${name}: no tool start seen; treated as a webhook run's call`)
    const refused = runRefusalForChat(placed.capabilities, botId, name, raw, beyondOwn, t3Enabled)
    if (refused && chatId) calls.dropClaim?.(botId, name, chatId)
    return refused
  }
}
