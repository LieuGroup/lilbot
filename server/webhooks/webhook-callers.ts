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
import type { CallingChats } from '../threads/calling-chats'
import type { WebhookStore } from './webhook-store'

/** What a session that cannot be placed may do: nothing beyond the narrow set. */
const UNPLACED: WebhookCapability[] = []

export function webhookCallers(store: Pick<WebhookStore, 'runForChat' | 'hasRuns'>, rootOf: SessionRoot, calls: Pick<CallingChats, 'gate'>) {
  /** The session's webhook run (null: none), also after the engine compressed it; undefined while its lineage is unreadable. */
  const runOf = (botId: string, chatId: string) => {
    const direct = store.runForChat(botId, chatId)
    if (direct) return direct
    const root = rootOf(botId, chatId)
    if (root === null) return undefined
    return root === chatId ? null : store.runForChat(botId, root)
  }
  /** What a session of the bot may do: its webhook's groups, or null when it is not a webhook run's session. */
  const forChat = (botId: string, chatId: string | undefined): WebhookCapability[] | null => {
    if (!store.hasRuns(botId)) return null
    if (!chatId) return UNPLACED
    const run = runOf(botId, chatId)
    return run === undefined ? UNPLACED : run ? run.capabilities : null
  }

  return {
    run: runOf,
    hasRuns: (botId: string) => store.hasRuns(botId),
    forChat,
    /** For an MCP call of `tool` with these arguments: what the webhook run that made it may do, or null when another
     *  session made it. Waits for the call's own start up to `calls.waitMs`; a call never seen counts as a run's. */
    async forCall(botId: string, tool: string, raw: unknown): Promise<WebhookCapability[] | null> {
      if (!store.hasRuns(botId)) return null
      const own = await calls.gate(botId, tool, raw, chatId => runOf(botId, chatId) !== null)
      if (own === null) {
        console.warn(`[webhook-session] ${tool}: no tool start seen; treated as a webhook run's call`)
        return UNPLACED
      }
      return forChat(botId, own)
    }
  }
}

export type WebhookCallers = ReturnType<typeof webhookCallers>
