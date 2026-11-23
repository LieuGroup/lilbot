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
  activeNarrowedCaps?(botId: string): WebhookCapability[] | null
  narrowedForChat(botId: string, chatId: string): WebhookCapability[] | null | undefined
}

export function webhookCallers(store: Pick<WebhookStore, 'runForChat' | 'hasRuns'>, rootOf: SessionRoot, calls: Pick<CallingChats, 'gate'>, narrowed?: NarrowedSessions) {
  /** The session's webhook run (null: none), also after the engine compressed it; undefined while its lineage is unreadable. */
  const runOf = (botId: string, chatId: string) => {
    const direct = store.runForChat(botId, chatId)
    if (direct) return direct
    const root = rootOf(botId, chatId)
    if (root === null) return undefined
    return root === chatId ? null : store.runForChat(botId, root)
  }
  /** Capabilities for an unplaced call on `botId`, or null when no webhook run or live local narrowed session can be calling. */
  const unplacedCapabilities = (botId: string): WebhookCapability[] | null => {
    if (store.hasRuns(botId)) return UNPLACED
    if (!narrowed) return null
    return narrowed.activeNarrowedCaps ? narrowed.activeNarrowedCaps(botId) : narrowed.hasNarrowed(botId) ? UNPLACED : null
  }
  const hasRuns = (botId: string) => unplacedCapabilities(botId) !== null
  /** What a session of the bot may do: its narrowed groups, or null when it is unrestricted. */
  const forChat = (botId: string, chatId: string | undefined): WebhookCapability[] | null => {
    const hasHook = store.hasRuns(botId)
    const hasThread = Boolean(narrowed?.hasNarrowed(botId))
    if (!hasHook && !hasThread) return null
    const live = unplacedCapabilities(botId)
    if (!chatId) return live
    if (hasHook) {
      const run = runOf(botId, chatId)
      if (run === undefined) return UNPLACED
      if (run) return run.capabilities
    }
    if (hasThread) {
      const caps = narrowed!.narrowedForChat(botId, chatId)
      if (caps === undefined) return UNPLACED
      if (caps !== null) return caps
    }
    return null
  }

  return {
    run: runOf,
    hasRuns,
    unplacedCapabilities,
    forChat,
    /** For an MCP call of `tool` with these arguments: what the narrowed run that made it may do, or null when another
     *  session made it. Waits for the call's own start up to `calls.waitMs`; a call never seen counts as narrowed. */
    async forCall(botId: string, tool: string, raw: unknown): Promise<WebhookCapability[] | null> {
      const unplaced = unplacedCapabilities(botId)
      if (unplaced === null) return null
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
