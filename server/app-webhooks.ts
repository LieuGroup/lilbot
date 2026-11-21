/** Builds the webhooks' service, scheduler and the pieces that keep their runs narrow (#12, finding 3): which calls come
 *  from a webhook run's session, decided by the session and never by time (`webhook-callers.ts`). */
import type { Database } from 'bun:sqlite'
import type { ActivityEvent } from '../shared/activity-schema'
import type { EventFrame } from '../shared/protocol'
import type { ActivityService } from './activity/activity-service'
import type { BotPrefsStore } from './bots/bot-prefs-store'
import type { BotService } from './bots/bot-service'
import type { BotStore } from './bots/bot-store'
import type { SessionRoot } from './bots/hidden-chats'
import type { HistoryStore } from './history/history-store'
import { pluginCall, SESSION_HEADER } from './http/engine-run-gate'
import { RoutineScheduler } from './routines/routine-scheduler'
import { refusalFor } from './system/run-access'
import type { CallingChats } from './threads/calling-chats'
import { webhookCallers } from './webhooks/webhook-callers'
import { WebhookMessages } from './webhooks/webhook-messages'
import { WebhookService } from './webhooks/webhook-service'
import type { WebhookStore } from './webhooks/webhook-store'

/** A run's message to its bot, as a notice: a line in the bot's main conversation that turns it unread, and the text the
 *  bot gets with Oscar's next message there (`BotServiceOptions.turnNotes`). No model turn. */
export function webhookMessages(database: Database, store: BotStore, prefs: BotPrefsStore, history: HistoryStore, activity: ActivityService, publish: (frame: EventFrame) => void) {
  return new WebhookMessages(
    database,
    (botId, runId, source, text) => {
      const main = prefs.mainChat(botId)
      if (!main || !store.exists(botId)) return false
      history.reference(botId, main, { kind: 'tool', toolId: `webhook-message:${runId}`, name: 'webhook message', detail: `${source}: ${text}`, running: false }, Date.now())
      publish({ event: 'history.changed', botId })
      activity.setUnread(botId, true)
      return true
    },
    () => publish({ event: 'webhooks.changed' })
  )
}

interface WebhookDeps {
  webhookStore: WebhookStore
  messages: WebhookMessages
  bots: BotService
  rootOf: SessionRoot
  calls: CallingChats
  token: string
  origin: string | undefined
  observeRun: (event: ActivityEvent) => void
  publish: (frame: EventFrame) => void
  repeat: (label: string, ms: number, task: () => void) => void
}

export function createWebhooks({ webhookStore, messages, bots, rootOf, calls, token, origin, observeRun, publish, repeat }: WebhookDeps) {
  const webhooks = new WebhookService(webhookStore, bots, token, origin, () => publish({ event: 'webhooks.changed' }))
  const callers = webhookCallers(webhookStore, rootOf, calls)
  const scheduler = new RoutineScheduler(webhooks, observeRun)
  repeat('webhooks', 1000, () => scheduler.tick())
  repeat('webhook messages', 1000, () => messages.tick())
  /** The refusals outside LilBot's own MCP server: memory, plug-in tools (by the session they name) and T3 Code. */
  const gates = {
    memoryLocked: (botId: string, chatId: string | undefined) => {
      const allowed = callers.forChat(botId, chatId)
      return allowed === null || allowed.includes('memory') ? null : 'A webhook run cannot use memory or give files. Put what matters in your result.'
    },
    pluginRefusal: async (botId: string, pathname: string, request: Request) => {
      const body = await request
        .clone()
        .json()
        .catch(() => null)
      const call = pluginCall(pathname, body)
      return call ? refusalFor(callers.forChat(botId, request.headers.get(SESSION_HEADER) || undefined), call.tool, call.groups) : null
    },
    t3Refusal: async (botId: string, tool: string, args: unknown) => refusalFor(await callers.forCall(botId, tool, args), tool, ['coding'])
  }
  return { webhooks, gates, webhookRuns: { callers, messages, callingChat: (botId: string, requestId: string) => calls.find(botId, 'lilbot_webhook_message', requestId) } }
}
