/** Which calls to LilBot come from a webhook run's session, and what Oscar lets that webhook's runs do (#12, finding 3).
 *  Decided by the session, never by time: a webhook session and the sessions the engine continued it in stay narrow for
 *  as long as they exist, whether the run is under way, settled, or the engine works on its transcript later (Hermes'
 *  background review forks share the session's id). A call that names its session (memory, plug-ins) is looked up; an
 *  MCP call carries none, so it is matched to its own tool start (`CallingChats.gate`: exact arguments or request id
 *  first, falling back after a grace window only when strictly one unmatched start exists for a call without request id).
 *  It fails closed: a call that cannot be placed, or whose session's lineage cannot be read, counts as a webhook run's.
 *  Calls of a bot that never had a webhook run are never held. */
import { LilBotError } from '../../shared/lilbot-error'
import type { WebhookCapability } from '../../shared/webhook-schema'
import type { SessionRoot } from '../bots/hidden-chats'
import { AMBIGUOUS, AMBIGUOUS_MATCH, type CallingChats, NOT_SEEN } from '../threads/calling-chats'
import type { WebhookStore } from './webhook-store'

/** What a session that cannot be placed may do: nothing beyond the narrow set. */
const UNPLACED: WebhookCapability[] = []

/** Narrowed non-webhook sessions (such as exchanges, workers, or groups handed out from a narrowed run). */
export interface NarrowedSessions {
  hasNarrowed(botId: string): boolean
  activeNarrowedCaps?(botId: string, sessionCaps?: (botId: string, chatId: string) => WebhookCapability[] | null | undefined): WebhookCapability[] | null
  narrowedForChat(botId: string, chatId: string): WebhookCapability[] | null | undefined
}

export interface PlaceCallOptions {
  /** Which `CallingChats` slot to consume (`gated` for MCP gates, `claimed` for service actions). Default `'gated'`. */
  slot?: 'gated' | 'claimed'
  /** Wait for a start even when no limited run is live (e.g., while a check session runs). */
  forceGate?: boolean
  /** Skip live-run gating when the live intersection already allows this call; still 0ms-peeks settled limited sessions. */
  liveAllowed?: boolean
  /** Extra ambiguity predicate OR'd with limited-session detection (e.g., active check sessions). */
  prefer?: (chatId: string) => boolean
  /** Override limited-session ambiguity predicate (e.g., only sessions that would be refused this specific call). */
  limitedPrefer?: (chatId: string) => boolean
}

export type CallPlacement =
  | { kind: 'ambiguous' }
  | { kind: 'placed'; chatId: string; capabilities: WebhookCapability[] | null }
  | { kind: 'unplaced'; capabilities: WebhookCapability[] | null }

export function webhookCallers(
  store: Pick<WebhookStore, 'runForChat' | 'hasRuns'> & Partial<Pick<WebhookStore, 'activeRunCaps'>>,
  rootOf: SessionRoot,
  calls: Pick<CallingChats, 'gate'> & Partial<Pick<CallingChats, 'peek' | 'claim'>>,
  narrowed?: NarrowedSessions
) {
  /** The session's webhook run (null: none), also after the engine compressed it; undefined while its lineage is unreadable. */
  const runOf = (botId: string, chatId: string) => {
    const direct = store.runForChat(botId, chatId)
    if (direct) return direct
    const root = rootOf(botId, chatId)
    if (root === null) return undefined
    return root === chatId ? null : store.runForChat(botId, root)
  }
  const hasHistory = (botId: string) => store.hasRuns(botId) || Boolean(narrowed?.hasNarrowed(botId))
  /** Named-session capabilities across webhook runs and narrowed threads; undefined when lineage is unreadable. */
  const sessionCaps = (botId: string, chatId: string): WebhookCapability[] | null | undefined => {
    if (store.hasRuns(botId)) {
      const run = runOf(botId, chatId)
      if (run === undefined) return undefined
      if (run) return run.capabilities
    }
    if (narrowed?.hasNarrowed(botId)) {
      const caps = narrowed.narrowedForChat(botId, chatId)
      if (caps === undefined) return undefined
      if (caps !== null) return caps
    }
    return null
  }
  /** Capabilities for an unplaced call on `botId`: intersection of live webhook runs and live local narrowed deliveries,
   *  or null when neither is live. */
  const unplacedCapabilities = (botId: string): WebhookCapability[] | null => {
    let caps: WebhookCapability[] | null = null
    const intersect = (next: WebhookCapability[]) => {
      caps = caps === null ? [...next] : caps.filter(c => next.includes(c))
    }
    const activeRuns = store.activeRunCaps ? store.activeRunCaps(botId) : store.hasRuns(botId) ? [UNPLACED] : []
    for (const runCaps of activeRuns) intersect(runCaps)
    if (narrowed) {
      const threadCaps = narrowed.activeNarrowedCaps ? narrowed.activeNarrowedCaps(botId, sessionCaps) : narrowed.hasNarrowed(botId) ? UNPLACED : null
      if (threadCaps !== null) intersect(threadCaps)
    }
    return caps
  }
  const hasRuns = (botId: string) => unplacedCapabilities(botId) !== null
  /** What a session of the bot may do: its narrowed groups, or null when it is unrestricted. */
  const forChat = (botId: string, chatId: string | undefined): WebhookCapability[] | null => {
    if (!chatId) return unplacedCapabilities(botId)
    if (!hasHistory(botId)) return null
    const caps = sessionCaps(botId, chatId)
    return caps === undefined ? UNPLACED : caps
  }

  /** Single shared caller-limitation decision used by every MCP gate and service action.
   *  While a limited run or local narrowed delivery is live (or `forceGate` is set), gates in `CallingChats`;
   *  when idle, performs a 0ms `peek` so any reported start from a session that was ever limited is still caught. */
  const placeCall = async (botId: string, tool: string, raw: unknown, opts: PlaceCallOptions = {}): Promise<CallPlacement> => {
    const slot = opts.slot ?? 'gated'
    const unplaced = unplacedCapabilities(botId)
    const liveLimited = unplaced !== null
    const shouldGate = Boolean(opts.forceGate) || (liveLimited && !opts.liveAllowed)
    const isLimited = opts.limitedPrefer ?? ((chatId: string) => forChat(botId, chatId) !== null)
    const prefer = (chatId: string) => Boolean(opts.prefer?.(chatId)) || isLimited(chatId)
    if (!shouldGate) {
      if (!hasHistory(botId) || !calls.peek) return { kind: 'unplaced', capabilities: null }
      const seen = calls.peek(botId, tool, raw, prefer, slot)
      if (seen === AMBIGUOUS_MATCH) return { kind: 'ambiguous' }
      return seen ? { kind: 'placed', chatId: seen, capabilities: forChat(botId, seen) } : { kind: 'unplaced', capabilities: null }
    }
    const matched = slot === 'claimed' && calls.claim ? await calls.claim(botId, tool, raw, prefer) : await calls.gate(botId, tool, raw, prefer)
    if (matched === AMBIGUOUS_MATCH) return { kind: 'ambiguous' }
    if (matched === null) return { kind: 'unplaced', capabilities: liveLimited ? unplaced : null }
    return { kind: 'placed', chatId: matched, capabilities: forChat(botId, matched) }
  }

  return {
    run: runOf,
    hasRuns,
    hasHistory,
    unplacedCapabilities,
    forChat,
    placeCall,
    /** For an MCP gate call (`gated` slot): capabilities of the limited run that made it, or null when unrestricted. */
    async forCall(botId: string, tool: string, raw: unknown): Promise<WebhookCapability[] | null> {
      const res = await placeCall(botId, tool, raw, { slot: 'gated' })
      if (res.kind === 'ambiguous') return UNPLACED
      if (res.kind === 'unplaced' && res.capabilities !== null) console.warn(`[webhook-session] ${tool}: no tool start seen; treated as a webhook run's call`)
      return res.capabilities
    },
    /** For a service-level action (`claimed` slot, e.g., delegation/group control & replay): capabilities of the calling
     *  limited session (live or settled), or null when unrestricted. Throws on ambiguity or unplaced live calls. */
    async forAction(botId: string, tool: string, raw: unknown): Promise<WebhookCapability[] | null> {
      const res = await placeCall(botId, tool, raw, { slot: 'claimed' })
      if (res.kind === 'ambiguous') throw new LilBotError('session_ambiguous', AMBIGUOUS)
      if (res.kind === 'unplaced' && res.capabilities !== null) throw new LilBotError('session_unknown', NOT_SEEN)
      return res.capabilities
    }
  }
}

export type WebhookCallers = ReturnType<typeof webhookCallers>
