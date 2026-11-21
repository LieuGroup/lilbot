/** Whether a call to one of LilBot's tools comes from a webhook run, and what Oscar lets that run do (#12, finding 3).
 *  MCP calls carry no session, so a call is matched to the tool calls the engine reported starting
 *  (`CallingChats.starts`). It fails closed: while a webhook run of the bot is under way, a call no session can be found
 *  for, or one whose session's lineage cannot be read, counts as the run's. */
import type { WebhookCapability } from '../../shared/webhook-schema'
import type { SessionRoot } from '../bots/hidden-chats'
import type { WebhookStore } from './webhook-store'

/** The bot's sessions that started a call of `tool` since a time, newest first, with their arguments' keys. */
export type ToolStarts = (botId: string, tool: string, since: number) => { chatId: string; args: string }[]

/** How long before its request a call's start counts, and how long a webhook run's own report may lag behind it. */
const FRESH_MS = 10_000
const GRACE_MS = 250

/** What every one of the runs may do. */
const common = (lists: WebhookCapability[][]) => lists.reduce((all, list) => all.filter(item => list.includes(item)), lists[0] ?? [])

export function webhookCallers(store: Pick<WebhookStore, 'runForChat' | 'underWay'>, rootOf: SessionRoot, starts: ToolStarts, waitMs = 3000) {
  /** The session's webhook run (null: none), also after the engine compressed it; undefined while its lineage is unreadable. */
  const runOf = (botId: string, chatId: string) => {
    const direct = store.runForChat(botId, chatId)
    if (direct) return direct
    const root = rootOf(botId, chatId)
    if (root === null) return undefined
    return root === chatId ? null : store.runForChat(botId, root)
  }

  return {
    run: runOf,
    /** For a call that names its session (memory writes): what its webhook run may do, or null for any other session.
     *  Without a session, or with an unreadable one, it counts as a run's while one is under way. */
    forChat(botId: string, chatId: string | undefined): WebhookCapability[] | null {
      const run = chatId ? runOf(botId, chatId) : undefined
      if (run !== undefined) return run ? run.capabilities : null
      const under = store.underWay(botId)
      return under.length ? common(under) : null
    },

    /** For a call of `tool` with these arguments (`argsKey`; null when the caller reshaped them, so any start of the tool
     *  matches): what the webhook run that made it may do, or null when a session that is not a webhook run made this
     *  call. Waits up to `waitMs` for the engine's report. */
    async forCall(botId: string, tool: string, args: string | null): Promise<WebhookCapability[] | null> {
      if (!store.underWay(botId).length) return null
      const asked = Date.now()
      await Bun.sleep(GRACE_MS)
      for (;;) {
        const under = store.underWay(botId)
        if (!under.length) return null
        const found = starts(botId, tool, asked - FRESH_MS)
        const runs = found.map(start => runOf(botId, start.chatId))
        if (runs.includes(undefined)) return common(under)
        const hooks = runs.flatMap(run => (run ? [run.capabilities] : []))
        if (hooks.length) return common(hooks)
        if (found.some(start => args === null || start.args === args)) return null
        if (Date.now() >= asked + waitMs) return common(under)
        await Bun.sleep(100)
      }
    }
  }
}

export type WebhookCallers = ReturnType<typeof webhookCallers>
