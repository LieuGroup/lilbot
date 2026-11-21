/** Which conversation of a bot made a call to LilBot's MCP server. MCP requests carry no session, so the engine reports
 *  every tool call it sees start (`BotEngine.onToolCall`) and a call is matched to its own start: same tool and request
 *  id, seen at most `EARLY_MS` before the request (or while it waits), and not matched to another call already. Hidden
 *  runs are reported by the socket that submitted them, almost at once; visible sessions (the main conversation) by the
 *  chat that has them open or the activity observer, within a second or two. A call whose start is not seen in time, or
 *  that two sessions could have made, is refused with a retryable error: it is never guessed. */
import { LilBotError } from '../../shared/lilbot-error'

const KEEP_MS = 120_000
/** How long before its request a call's own start may have been seen: an older one belongs to an earlier call. */
const EARLY_MS = 15_000
/** Minimum grace window for exact-arg matching before falling back to a lone unmatched start (tools without requestId). */
const FALLBACK_GRACE_MS = 500
/** The tools that need to know their calling conversation. Engines may prefix the name with the server's. */
export type CallingTool = 'lilbot_delegate' | 'lilbot_work' | 'lilbot_group' | 'lilbot_goal' | 'lilbot_give_file' | 'lilbot_webhook_message' | 'lilbot_connection'

/** Matches a LilBot-owned server prefix or exact tool name, never an outside `lilbot_c_*` or third-party server. */
const names = (name: string, tool: string) => {
  if (name === tool) return true
  if (tool.startsWith('mcp__')) return false
  if (tool.startsWith('lilbot_')) return name === `mcp__lilbot_system__${tool}`
  return name === `mcp__lilbot_t3__${tool}`
}
const record = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {})

/** The tools a call runs. Tool search wraps them: `tool_call({ calls: [{ name, arguments }] })` or a single
 *  `{ name, arguments }`, with each call's arguments as an object or JSON text. */
function called(tool: string, args: unknown): { name: string; args: Record<string, unknown> }[] {
  const outer = record(args)
  if (tool !== 'tool_call') return [{ name: tool, args: outer }]
  return (Array.isArray(outer.calls) ? outer.calls : [outer]).flatMap(entry => {
    const call = record(entry)
    if (typeof call.name !== 'string') return []
    try {
      return [{ name: call.name, args: record(typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments) }]
    } catch {
      return []
    }
  })
}

/** Arguments as text that does not depend on key order, to tell two calls of one tool apart. */
export function argsKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(argsKey).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${argsKey((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

interface Seen {
  botId: string
  chatId: string
  /** The engine's id of the call with what it ran: one call reported twice (by a chat and the observer) is one entry. */
  key: string | null
  tool: string
  args: string
  requestId: string | null
  at: number
  claimed: boolean
  /** Taken by a gate (`take` / `takeSingle`), apart from `claimed`: one call is placed once by its gate and once by `find`. */
  gated: boolean
}

export const NOT_SEEN = 'LilBot could not tell which of your conversations made this call. Make the same call again in a moment, from your own conversation (not a sub-agent).'
const TWO = 'Two of your conversations made this call with the same requestId at once, so LilBot cannot tell them apart. Make it again with a new requestId.'

export class CallingChats {
  private seen: Seen[] = []
  /** How long a call waits for its start to be reported. */
  constructor(readonly waitMs = 5000) {}

  saw(botId: string, chatId: string, tool: string, args: unknown, callId?: string) {
    const now = Date.now()
    this.seen = this.seen.filter(s => now - s.at < KEEP_MS)
    for (const [i, call] of called(tool, args).entries()) {
      if (!call.name.includes('lilbot_')) continue
      const requestId = typeof call.args.requestId === 'string' ? call.args.requestId : null
      const entry = { botId, chatId, tool: call.name, args: argsKey(call.args), requestId, at: now, claimed: false, gated: false }
      const key = callId ? `${botId}\n${callId}\n${i}\n${entry.tool}\n${entry.args}` : null
      if (!key || !this.seen.some(s => s.key === key)) this.seen.push({ ...entry, key })
    }
  }

  /** The session that made this call of `tool`, matched once; refuses (retryable) when that cannot be known. */
  async find(botId: string, tool: CallingTool, requestId: string): Promise<string> {
    const asked = Date.now()
    for (;;) {
      const own = this.seen.filter(s => !s.claimed && s.botId === botId && s.requestId === requestId && s.at >= asked - EARLY_MS && names(s.tool, tool))
      if (new Set(own.map(s => s.chatId)).size > 1) {
        console.warn(`[calling-session] ${tool}: two sessions could have made this call; refused`)
        throw new LilBotError('session_unknown', TWO)
      }
      if (own.length) {
        own[0].claimed = true
        if (own[0].at - asked > 1000) console.warn(`[calling-session] ${tool}: matched ${own[0].at - asked} ms after the call arrived`)
        return own[0].chatId
      }
      if (Date.now() - asked >= this.waitMs) {
        console.warn(`[calling-session] ${tool}: no tool start seen in ${this.waitMs} ms; refused`)
        throw new LilBotError('session_unknown', NOT_SEEN)
      }
      await Bun.sleep(50)
    }
  }

  /** For a gate: the session of this call's own exact-arg or request-id start since `since` that no gate has taken yet.
   *  When `prefer` is given and several starts match, a preferred session (e.g. a restricted run/check) is taken first. */
  take(botId: string, tool: string, since: number, args: string, requestId: string | null, prefer?: (chatId: string) => boolean): string | null {
    const matches = this.seen.filter(
      s => !s.gated && s.botId === botId && s.at >= since && names(s.tool, tool) && (s.args === args || (requestId !== null && s.requestId === requestId))
    )
    if (!matches.length) return null
    const own = (prefer && matches.find(s => prefer(s.chatId))) ?? matches[0]
    own.gated = true
    return own.chatId
  }

  /** Fail-closed fallback for tools without requestId whose raw model arguments differ after coercion or truncation:
   *  succeeds only when strictly ONE unmatched start of `tool` exists in `[since, maxAt]`, never when zero or multiple exist. */
  takeSingle(botId: string, tool: string, since: number, maxAt: number): string | null {
    const unmatched = this.seen.filter(s => !s.gated && s.botId === botId && s.at >= since && names(s.tool, tool))
    if (unmatched.length !== 1 || unmatched[0].at > maxAt) return null
    unmatched[0].gated = true
    return unmatched[0].chatId
  }

  /** Places an MCP call once for session gates: exact argument/requestId match immediately; for calls without requestId,
   *  falls back to `takeSingle` only after a grace window so concurrent restricted-session starts arrive first. Null when unplaced (fail closed). */
  async gate(botId: string, tool: string, raw: unknown, prefer?: (chatId: string) => boolean): Promise<string | null> {
    const args = record(raw)
    const key = argsKey(args)
    const requestId = typeof args.requestId === 'string' ? args.requestId : null
    const asked = Date.now()
    const graceMs = Math.min(FALLBACK_GRACE_MS, Math.floor(this.waitMs / 2))
    const stepMs = Math.min(50, Math.max(10, Math.floor(this.waitMs / 5)))
    for (;;) {
      const own = this.take(botId, tool, asked - EARLY_MS, key, requestId, prefer)
      if (own !== null) return own
      const now = Date.now()
      if (requestId === null && now - asked >= graceMs) {
        const single = this.takeSingle(botId, tool, asked - EARLY_MS, now - graceMs)
        if (single !== null) return single
      }
      if (now - asked >= this.waitMs) return null
      await Bun.sleep(stepMs)
    }
  }

  /** The bot's sessions that started a call of `tool` since `since`, newest first, with the arguments as `argsKey` gives
   *  them. Matched or not: for checks that only refuse. */
  starts(botId: string, tool: string, since: number): { chatId: string; args: string; requestId: string | null }[] {
    return this.seen
      .filter(s => s.botId === botId && s.at >= since && names(s.tool, tool))
      .reverse()
      .map(({ chatId, args, requestId }) => ({ chatId, args, requestId }))
  }
}
