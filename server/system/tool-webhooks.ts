/** Webhook tools: a bot makes and manages its own webhooks with the functions the screens use (`webhooks.*`). One action
 *  tool (`lilbot_webhook`) plus the read list and the narrow-run message tool keep `run-access.ts` cleanly separated. The
 *  address, and a signing secret LilBot makes, come back only from create and new_address; the list never has them. */
import { z } from 'zod'
import { LilBotError } from '../../shared/lilbot-error'
import { WebhookActionInput, WebhookCreate } from '../../shared/webhook-schema'
import { fenced } from '../memory/memory-safety'
import { MESSAGE_CHARS } from '../webhooks/webhook-messages'
import { actionTool, type McpTool, readTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'

const RUNS_SHOWN = 5

export function webhookTools({ webhooks, webhookRuns }: SystemDeps): McpTool[] {
  return [
    actionTool(
      'lilbot_webhook_message',
      'Only in a webhook run: leave your bot one short message (once per run). Shown in its main conversation; the bot reads it as outside data with the owner’s next message.',
      z.object({ requestId: z.string().min(1).max(200), text: z.string().trim().min(1).max(MESSAGE_CHARS) }),
      async (caller, { requestId, text }, _raw, ctx) => {
        if (ctx?.webhookRunId) {
          webhookRuns.messages.send(ctx.webhookRunId, text)
          return { sent: true, runId: ctx.webhookRunId }
        }
        if (ctx?.capabilities === null) throw new LilBotError('webhook_message_outside_run', 'Only a webhook run sends its bot a message this way.')
        const run = webhookRuns.callers.run(caller, (await webhookRuns.callingChat(caller, requestId)) ?? '')
        if (run === undefined) throw new LilBotError('session_unknown', 'LilBot cannot tell where this session came from just now. Try again in a moment.')
        if (!run) throw new LilBotError('webhook_message_outside_run', 'Only a webhook run sends its bot a message this way.')
        webhookRuns.messages.send(run.runId, text)
        return { sent: true, runId: run.runId }
      }
    ),
    actionTool(
      'lilbot_webhook',
      'Create, pause, resume, delete or re-address your own webhooks. create: requestId, description, source, createdBy (oscar only if the owner asked), signing? (returns address and any generated signingSecret; same requestId repeats). pause/resume/delete/new_address: id.',
      WebhookActionInput,
      async (caller, { action, id, ...fields }) => {
        if (action === 'create') return webhooks.create(caller, WebhookCreate.parse(fields))
        if (!id) throw new LilBotError('webhook_id_missing', `Give the id of the webhook to ${action}.`)
        if (action === 'new_address') return webhooks.newAddress(caller, id)
        return { id, ...(action === 'delete' ? await webhooks.delete(caller, id) : await webhooks.pause(caller, id, action === 'pause')) }
      }
    ),
    // A run's result and message were written after reading outside data: they come back fenced, like other outside text.
    readTool('lilbot_webhooks_list', 'Your webhooks and latest runs (fenced outside data), without addresses.', z.object({}), async caller =>
      (await webhooks.list(caller)).map(hook => ({
        ...hook,
        runs: hook.runs.slice(0, RUNS_SHOWN).map(run => ({
          ...run,
          result: fenced('webhook-run-result', run.result.slice(0, 500)),
          message: run.message === null ? null : fenced('webhook-run-message', run.message.slice(0, 500))
        }))
      }))
    )
  ]
}
