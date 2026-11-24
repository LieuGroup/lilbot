/** Which conversation of a bot made a call to LilBot's MCP server. MCP requests carry no session, so the engine reports
 *  every tool call it sees start (`BotEngine.onToolCall`) and a call is matched to its own start: same tool and request
 *  id, seen at most `EARLY_MS` before the request (or while it waits), and not matched to another call already. Hidden
 *  runs are reported by the socket that submitted them, almost at once; visible sessions (the main conversation) by the
 *  chat that has them open or the activity observer, within a second or two. A call whose start is not seen in time, or
 *  that two sessions could have made, is refused with a retryable error: it is never guessed. */
import { LilBotError } from '../../shared/lilbot-error'
import { argsKey, asRecord, type BotNamer, type CallingToolCatalog, defaultNamer, expectedToolName, isOwnedTool, type ToolName } from './calling-tool-names'

export { argsKey, type BotNamer, type CallingToolCatalog, type ToolName }

const KEEP_MS = 120_000
/** How long before its request a call's own start may have been seen: an older one belongs to an earlier call. */
const EARLY_MS = 15_000
/** Minimum grace window for exact-arg matching before falling back to a lone unmatched start (tools without requestId). */
const FALLBACK_GRACE_MS = 500
/** The tools that need to know their calling conversation. Engines may prefix the name with the server's. */
type CallingTool = 'lilbot_delegate' | 'lilbot_delegation' | 'lilbot_work' | 'lilbot_group' | 'lilbot_goal' | 'lilbot_give_file' | 'lilbot_webhook_message' | 'lilbot_connection'

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
  private readonly namer: BotNamer
  private readonly services?: CallingToolCatalog['services']
  private readonly t3Set: ReadonlySet<string>

  /** How long a call waits for its start to be reported. */
  constructor(
    readonly waitMs = 5000,
    tools: ToolName | CallingToolCatalog = {}
  ) {
    if (typeof tools === 'function') {
      this.namer = botId => (server, tool) => tools(botId, server, tool)
      this.t3Set = new Set()
    } else {
      this.namer = tools.namer ?? (() => defaultNamer)
      this.services = tools.services
      this.t3Set = new Set(tools.t3Tools)
    }
  }

  private expected(botId: string, tool: string): string | null {
    return expectedToolName(this.namer(botId), tool)
  }

  saw(botId: string, chatId: string, tool: string, args: unknown, callId?: string) {
    const now = Date.now()
    this.seen = this.seen.filter(s => now - s.at < KEEP_MS)
    if (!isOwnedTool(this.namer(botId), tool, { services: this.services, t3Set: this.t3Set })) return
    const parsed = asRecord(args)
    const requestId = typeof parsed.requestId === 'string' ? parsed.requestId : null
    const entry: Omit<Seen, 'key'> = { botId, chatId, tool, args: argsKey(parsed), requestId, at: now, claimed: 'open', gated: 'open' }
    const key = callId ? `${botId}\n${callId}\n${entry.tool}\n${entry.args}` : null
    if (!key || !this.seen.some(s => s.key === key)) this.seen.push({ ...entry, key })
  }

  /** The session that made this call of `tool`, matched once; refuses (retryable) when that cannot be known. */
  async find(botId: string, tool: CallingTool, requestId: string): Promise<string> {
    const asked = Date.now()
    const expected = this.expected(botId, tool)
    for (;;) {
      const own = this.seen.filter(
        s => s.claimed === 'open' && s.botId === botId && s.requestId === requestId && s.at >= asked - EARLY_MS && (s.tool === tool || s.tool === expected)
      )
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
  take(
    botId: string,
    tool: string,
    since: number,
    args: string,
    requestId: string | null,
    prefer?: (chatId: string) => boolean,
    slot: 'gated' | 'claimed' = 'gated',
    expected: string | null = this.expected(botId, tool)
  ): Match {
    const matches = this.seen.filter(
      s =>
        s[slot] !== 'taken' &&
        s.botId === botId &&
        s.at >= since &&
        (s.tool === tool || s.tool === expected) &&
        (s.args === args || (requestId !== null && s.requestId === requestId))
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
  takeSingle(botId: string, tool: string, since: number, maxAt: number, slot: 'gated' | 'claimed' = 'gated', expected: string | null = this.expected(botId, tool)): string | null {
    const unmatched = this.seen.filter(s => s[slot] === 'open' && s.botId === botId && s.at >= since && (s.tool === tool || s.tool === expected))
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
    const args = asRecord(raw)
    const key = argsKey(args)
    const requestId = typeof args.requestId === 'string' ? args.requestId : null
    const expected = this.expected(botId, tool)
    const asked = Date.now()
    const graceMs = Math.min(FALLBACK_GRACE_MS, Math.floor(this.waitMs / 2))
    const stepMs = Math.min(50, Math.max(10, Math.floor(this.waitMs / 5)))
    for (;;) {
      const own = this.take(botId, tool, asked - EARLY_MS, key, requestId, prefer, slot, expected)
      if (own !== null) return own
      const now = Date.now()
      if (requestId === null && now - asked >= graceMs) {
        const single = this.takeSingle(botId, tool, asked - EARLY_MS, now - graceMs, slot, expected)
        if (single !== null) return single
      }
      if (now - asked >= this.waitMs) return null
      await Bun.sleep(stepMs)
    }
  }

  /** Retires the unclaimed slot of a call that a gate already placed and refused, so it never collides with later calls. */
  dropClaim(botId: string, tool: string, chatId: string) {
    const expected = this.expected(botId, tool)
    const entry = [...this.seen]
      .reverse()
      .find(s => s.botId === botId && s.chatId === chatId && s.gated === 'taken' && s.claimed === 'open' && (s.tool === tool || s.tool === expected))
    if (entry) entry.claimed = 'taken'
  }

  /** The bot's sessions that started a call of `tool` since `since`, newest first, with the arguments as `argsKey` gives
   *  them. Matched or not: for checks that only refuse. */
  starts(botId: string, tool: string, since: number): { chatId: string; args: string; requestId: string | null }[] {
    const expected = this.expected(botId, tool)
    return this.seen
      .filter(s => s.botId === botId && s.at >= since && (s.tool === tool || s.tool === expected))
      .reverse()
      .map(({ chatId, args, requestId }) => ({ chatId, args, requestId }))
  }
}
