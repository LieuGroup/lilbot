/** Which calls to LilBot come from a webhook run's session, and what Oscar lets that webhook's runs do (#12, finding 3).
 *  Decided by the session, never by time: a webhook session and the sessions the engine continued it in stay narrow for
 *  as long as they exist, whether the run is under way, settled, or the engine works on its transcript later (Hermes'
 *  background review forks share the session's id). A call that names its session (memory, plug-ins) is looked up; an
 *  MCP call carries none, so it is matched to exactly one tool start, its own (`CallingChats.take`: the oldest one with its
 *  arguments or request id that no other call has taken).
 *  It fails closed: a call that cannot be placed, or whose session's lineage cannot be read, counts as a webhook run's.
 *  Calls of a bot that never had a webhook run are never held. */
import type { WebhookCapability } from '../../shared/webhook-schema'
import type { SessionRoot } from '../bots/hidden-chats'
import { argsKey, type CallingChats } from '../threads/calling-chats'
import type { WebhookStore } from './webhook-store'

/** How long before its request a call's own start counts (as for `CallingChats.find`). */
const FRESH_MS = 15_000
/** What a session that cannot be placed may do: nothing beyond the narrow set. */
const UNPLACED: WebhookCapability[] = []

export function webhookCallers(store: Pick<WebhookStore, 'runForChat' | 'hasRuns'>, rootOf: SessionRoot, calls: Pick<CallingChats, 'take' | 'waitMs'>) {
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
    forChat,
    /** For an MCP call of `tool` with these arguments: what the webhook run that made it may do, or null when another
     *  session made it. Waits for the call's own start up to `calls.waitMs`; a call never seen counts as a run's. */
    async forCall(botId: string, tool: string, raw: unknown): Promise<WebhookCapability[] | null> {
      if (!store.hasRuns(botId)) return null
      const args = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
      const key = argsKey(args)
      const requestId = typeof args.requestId === 'string' ? args.requestId : null
      const asked = Date.now()
      for (;;) {
        const own = calls.take(botId, tool, asked - FRESH_MS, key, requestId)
        if (own !== null) return forChat(botId, own)
        if (Date.now() - asked >= calls.waitMs) {
          console.warn(`[webhook-session] ${tool}: no tool start seen; treated as a webhook run's call`)
          return UNPLACED
        }
        await Bun.sleep(50)
      }
    }
  }
}

export type WebhookCallers = ReturnType<typeof webhookCallers>
