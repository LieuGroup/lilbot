/** Which calls to LilBot come from a webhook run's session, and what Oscar lets that webhook's runs do (#12, finding 3).
 *  Decided by the session, never by time: a webhook session and the sessions the engine continued it in stay narrow for
 *  as long as they exist, whether the run is under way, settled, or the engine works on its transcript later (Hermes'
 *  background review forks share the session's id). A call that names its session (memory, plug-ins) is looked up; an
 *  MCP call carries none, so it is matched to its own tool start (`CallingChats.gate`: exact arguments or request id
 *  first, falling back after a grace window only when strictly one unmatched start exists for a call without request id).
 *  It fails closed: a call that cannot be placed, or whose session's lineage cannot be read, counts as a webhook run's.
 *  Calls of a bot that never had a webhook run are never held. */
import type { WebhookCapability } from '../../shared/webhook-schema'
import type { SessionRoot } from '../bots/hidden-chats'
import { AMBIGUOUS_MATCH, type CallingChats } from '../threads/calling-chats'
import type { WebhookStore } from './webhook-store'

/** What a session that cannot be placed may do: nothing beyond the narrow set. */
const UNPLACED: WebhookCapability[] = []

/** Narrowed non-webhook sessions (such as exchanges, workers, or groups handed out from a narrowed run). */
export interface NarrowedSessions {
  hasNarrowed(botId: string): boolean
  activeNarrowedCaps?(botId: string, sessionCaps?: (botId: string, chatId: string) => WebhookCapability[] | null | undefined): WebhookCapability[] | null
  narrowedForChat(botId: string, chatId: string): WebhookCapability[] | null | undefined
}

export function webhookCallers(
  store: Pick<WebhookStore, 'runForChat' | 'hasRuns'> & Partial<Pick<WebhookStore, 'activeRunCaps'>>,
  rootOf: SessionRoot,
  calls: Pick<CallingChats, 'gate'> & Partial<Pick<CallingChats, 'peek'>>,
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

  return {
    run: runOf,
    hasRuns,
    hasHistory,
    unplacedCapabilities,
    forChat,
    /** For an MCP call of `tool` with these arguments: what the narrowed run that made it may do, or null when another
     *  session made it. Gates only while a webhook run or local narrowed delivery is live; when idle, performs a 0ms peek
     *  so a reported start from a settled limited session is still refused without delaying unmatched calls. */
    async forCall(botId: string, tool: string, raw: unknown): Promise<WebhookCapability[] | null> {
      const unplaced = unplacedCapabilities(botId)
      if (unplaced === null) {
        if (!hasHistory(botId) || !calls.peek) return null
        const seen = calls.peek(botId, tool, raw, chatId => forChat(botId, chatId) !== null)
        return seen === AMBIGUOUS_MATCH ? UNPLACED : seen ? forChat(botId, seen) : null
      }
      const own = await calls.gate(botId, tool, raw, chatId => forChat(botId, chatId) !== null)
      if (own === AMBIGUOUS_MATCH) return UNPLACED
      if (own === null) {
        console.warn(`[webhook-session] ${tool}: no tool start seen; treated as a webhook run's call`)
        return unplaced
      }
      return forChat(botId, own)
    }
  }
}

export type WebhookCallers = ReturnType<typeof webhookCallers>
