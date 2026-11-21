/** Builds the webhooks' service, scheduler and the pieces that keep their runs narrow (#12, finding 3): which calls come
 *  from a webhook run, and the one message a run may send its bot, delivered to the bot's main conversation. */
import type { Database } from 'bun:sqlite'
import type { ActivityEvent } from '../shared/activity-schema'
import type { EventFrame } from '../shared/protocol'
import type { BotService } from './bots/bot-service'
import type { SessionRoot } from './bots/hidden-chats'
import { webhookLine } from './devices/origin-line'
import { pluginCall } from './http/engine-run-gate'
import { RoutineScheduler } from './routines/routine-scheduler'
import { refusalFor } from './system/run-access'
import { argsKey, type CallingChats } from './threads/calling-chats'
import { webhookCallers } from './webhooks/webhook-callers'
import { WebhookMessages } from './webhooks/webhook-messages'
import { WebhookService } from './webhooks/webhook-service'
import type { WebhookStore } from './webhooks/webhook-store'

interface WebhookDeps {
  database: Database
  webhookStore: WebhookStore
  bots: BotService
  rootOf: SessionRoot
  calls: CallingChats
  token: string
  origin: string | undefined
  observeRun: (event: ActivityEvent) => void
  publish: (frame: EventFrame) => void
  repeat: (label: string, ms: number, task: () => void) => void
}

export function createWebhooks({ database, webhookStore, bots, rootOf, calls, token, origin, observeRun, publish, repeat }: WebhookDeps) {
  const changed = () => publish({ event: 'webhooks.changed' })
  const webhooks = new WebhookService(webhookStore, bots, token, origin, changed)
  const callers = webhookCallers(webhookStore, rootOf, (botId, tool, since) => calls.starts(botId, tool, since))
  const messages = new WebhookMessages(
    database,
    // Like a new bot's greeting: the main conversation is opened (made, the first time) and the message sent hidden with a
    // stable input id, so a retry is the same admission; the reply arrives like any other.
    async (botId, prompt, runId) => {
      const chat = await bots.openChat(botId, undefined, () => {})
      try {
        await chat.send(prompt, { hidden: true, inputId: runId, origin: { line: webhookLine } })
      } finally {
        chat.close()
      }
    },
    changed
  )
  const scheduler = new RoutineScheduler(webhooks, observeRun)
  repeat('webhooks', 1000, () => scheduler.tick())
  repeat('webhook messages', 1000, () => messages.tick())
  /** The refusals outside LilBot's own MCP server: memory, plug-in tools and T3 Code. */
  const gates = {
    memoryLocked: (botId: string, chatId: string | undefined) => {
      const allowed = callers.forChat(botId, chatId)
      return allowed !== null && !allowed.includes('memory')
    },
    pluginRefusal: async (botId: string, pathname: string, request: Request) => {
      const call = pluginCall(
        pathname,
        await request
          .clone()
          .json()
          .catch(() => null)
      )
      return call ? refusalFor(callers, botId, call.tool, null, call.groups) : null
    },
    t3Refusal: (botId: string, tool: string, args: unknown) => refusalFor(callers, botId, tool, argsKey(args ?? {}), ['coding'])
  }
  return { webhooks, gates, webhookRuns: { callers, messages, callingChat: (botId: string, requestId: string) => calls.find(botId, 'lilbot_webhook_message', requestId) } }
}
