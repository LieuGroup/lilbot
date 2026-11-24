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
type CallingTool = 'lilbot_delegate' | 'lilbot_delegation' | 'lilbot_work' | 'lilbot_group' | 'lilbot_goal' | 'lilbot_give_file' | 'lilbot_webhook_message' | 'lilbot_connection'

const SYSTEM_SERVER = 'lilbot_system'
const T3_SERVER = 'lilbot_t3'
const RAW_TOOL = /^[a-z0-9]+(?:_[a-z0-9]+)*$/

/** Maps a LilBot-owned MCP server and raw tool name to the name `botId`'s engine reports in `onToolCall`. */
export type ToolName = (botId: string, server: string, tool: string) => string
const defaultToolName: ToolName = (_botId, server, tool) => `mcp__${server}__${tool}`

const record = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {})

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

type SlotState = 'open' | 'ambiguous' | 'taken'

interface Seen {
  botId: string
  chatId: string
  /** The engine's id of the call with what it ran: one call reported twice (by a chat and the observer) is one entry. */
  key: string | null
  tool: string
  args: string
  requestId: string | null
  at: number
  claimed: SlotState
  /** Taken by a gate (`take` / `takeSingle`), apart from `claimed`: one call is placed once by its gate and once by `find`. */
  gated: SlotState
}

export const NOT_SEEN = 'LilBot could not tell which of your conversations made this call. Make the same call again in a moment, from your own conversation (not a sub-agent).'
export const AMBIGUOUS = 'Two of your conversations made this call at once, so LilBot cannot tell them apart. Try again in a moment.'
export const AMBIGUOUS_MATCH = Symbol('ambiguous')
export type Match = string | typeof AMBIGUOUS_MATCH | null
const TWO = 'Two of your conversations made this call with the same requestId at once, so LilBot cannot tell them apart. Make it again with a new requestId.'

export class CallingChats {
  private seen: Seen[] = []
  /** How long a call waits for its start to be reported. */
  constructor(
    readonly waitMs = 5000,
    private toolName: ToolName = defaultToolName
  ) {}

  /** Matches a LilBot-owned server prefix for the bot's engine or exact tool name, never an outside `lilbot_c_*` or third-party server. */
  private matches(botId: string, seen: string, tool: string): boolean {
    if (seen === tool) return true
    if (!RAW_TOOL.test(tool) || tool.startsWith('lilbot_c_')) return false
    const server = tool.startsWith('lilbot_') ? SYSTEM_SERVER : T3_SERVER
    return seen === this.toolName(botId, server, tool)
  }

  saw(botId: string, chatId: string, tool: string, args: unknown, callId?: string) {
    const now = Date.now()
    this.seen = this.seen.filter(s => now - s.at < KEEP_MS)
    if (!tool.includes('lilbot_')) return
    const parsed = record(args)
    const requestId = typeof parsed.requestId === 'string' ? parsed.requestId : null
    const entry: Omit<Seen, 'key'> = { botId, chatId, tool, args: argsKey(parsed), requestId, at: now, claimed: 'open', gated: 'open' }
    const key = callId ? `${botId}\n${callId}\n${entry.tool}\n${entry.args}` : null
    if (!key || !this.seen.some(s => s.key === key)) this.seen.push({ ...entry, key })
  }

  /** The session that made this call of `tool`, matched once; refuses (retryable) when that cannot be known. */
  async find(botId: string, tool: CallingTool, requestId: string): Promise<string> {
    const asked = Date.now()
    for (;;) {
      const own = this.seen.filter(s => s.claimed === 'open' && s.botId === botId && s.requestId === requestId && s.at >= asked - EARLY_MS && this.matches(botId, s.tool, tool))
      if (new Set(own.map(s => s.chatId)).size > 1) {
        console.warn(`[calling-session] ${tool}: two sessions could have made this call; refused`)
        throw new LilBotError('session_unknown', TWO)
      }
      if (own.length) {
        own[0].claimed = 'taken'
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

  /** Matches an exact-arg or request-id start since `since` not yet taken in `slot`. Refuses all concurrent callers
   *  (`AMBIGUOUS_MATCH`) when starts span multiple sessions and at least one is restricted (`prefer`). */
  take(botId: string, tool: string, since: number, args: string, requestId: string | null, prefer?: (chatId: string) => boolean, slot: 'gated' | 'claimed' = 'gated'): Match {
    const matches = this.seen.filter(
      s => s[slot] !== 'taken' && s.botId === botId && s.at >= since && this.matches(botId, s.tool, tool) && (s.args === args || (requestId !== null && s.requestId === requestId))
    )
    if (!matches.length) return null
    const marked = matches.find(s => s[slot] === 'ambiguous')
    if (marked) {
      marked[slot] = 'taken'
      if (slot === 'gated') marked.claimed = 'taken'
      return AMBIGUOUS_MATCH
    }
    if (new Set(matches.map(s => s.chatId)).size > 1 && prefer && matches.some(s => prefer(s.chatId))) {
      console.warn(`[calling-session] ${tool}: mixed restricted/unrestricted starts matched; refusing ambiguous call`)
      for (const [i, s] of matches.entries()) {
        s[slot] = i === 0 ? 'taken' : 'ambiguous'
        if (slot === 'gated') s.claimed = 'taken'
      }
      return AMBIGUOUS_MATCH
    }
    matches[0][slot] = 'taken'
    return matches[0].chatId
  }

  /** Fail-closed fallback for tools without requestId whose raw model arguments differ after coercion or truncation:
   *  succeeds only when strictly ONE unmatched start of `tool` exists in `[since, maxAt]`, never when zero or multiple exist. */
  takeSingle(botId: string, tool: string, since: number, maxAt: number, slot: 'gated' | 'claimed' = 'gated'): string | null {
    const unmatched = this.seen.filter(s => s[slot] === 'open' && s.botId === botId && s.at >= since && this.matches(botId, s.tool, tool))
    if (unmatched.length !== 1 || unmatched[0].at > maxAt) return null
    unmatched[0][slot] = 'taken'
    return unmatched[0].chatId
  }

  /** Places an MCP call once for session gates (`gated` slot). Null when unplaced (fail closed). */
  gate(botId: string, tool: string, raw: unknown, prefer?: (chatId: string) => boolean): Promise<Match> {
    return this.place(botId, tool, raw, prefer, 'gated')
  }

  /** Places an MCP call once for service-level checks (`claimed` slot, independent of `gate`). Null when unplaced (fail closed). */
  claim(botId: string, tool: string, raw: unknown, prefer?: (chatId: string) => boolean): Promise<Match> {
    return this.place(botId, tool, raw, prefer, 'claimed')
  }

  private async place(botId: string, tool: string, raw: unknown, prefer: ((chatId: string) => boolean) | undefined, slot: 'gated' | 'claimed'): Promise<Match> {
    const args = record(raw)
    const key = argsKey(args)
    const requestId = typeof args.requestId === 'string' ? args.requestId : null
    const asked = Date.now()
    const graceMs = Math.min(FALLBACK_GRACE_MS, Math.floor(this.waitMs / 2))
    const stepMs = Math.min(50, Math.max(10, Math.floor(this.waitMs / 5)))
    for (;;) {
      const own = this.take(botId, tool, asked - EARLY_MS, key, requestId, prefer, slot)
      if (own !== null) return own
      const now = Date.now()
      if (requestId === null && now - asked >= graceMs) {
        const single = this.takeSingle(botId, tool, asked - EARLY_MS, now - graceMs, slot)
        if (single !== null) return single
      }
      if (now - asked >= this.waitMs) return null
      await Bun.sleep(stepMs)
    }
  }

  /** Retires the unclaimed slot of a call that a gate already placed and refused, so it never collides with later calls. */
  dropClaim(botId: string, tool: string, chatId: string) {
    const entry = [...this.seen].reverse().find(s => s.botId === botId && s.chatId === chatId && s.gated === 'taken' && s.claimed === 'open' && this.matches(botId, s.tool, tool))
    if (entry) entry.claimed = 'taken'
  }

  /** The bot's sessions that started a call of `tool` since `since`, newest first, with the arguments as `argsKey` gives
   *  them. Matched or not: for checks that only refuse. */
  starts(botId: string, tool: string, since: number): { chatId: string; args: string; requestId: string | null }[] {
    return this.seen
      .filter(s => s.botId === botId && s.at >= since && this.matches(botId, s.tool, tool))
      .reverse()
      .map(({ chatId, args, requestId }) => ({ chatId, args, requestId }))
  }
}
