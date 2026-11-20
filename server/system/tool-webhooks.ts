/** Webhook tools: a bot makes and manages its own webhooks with the functions the screens use (`webhooks.*`). The
 *  address, and a signing secret LilBot makes, come back only from create and new-address; the list never has them. */
import { z } from 'zod'
import { WebhookCreate } from '../../shared/webhook-schema'
import { fenced } from '../memory/memory-safety'
import { actionTool, type McpTool, readTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'

const one = z.object({ id: z.string().min(1) })
const RUNS_SHOWN = 5

export function webhookTools({ webhooks }: SystemDeps): McpTool[] {
  return [
    actionTool(
      'lilbot_webhook_create',
      'Make a webhook: a secret address an outside service calls to wake you with its events and this task (createdBy oscar only when he asked). Returns the address and any signing secret LilBot made (again for the same requestId): register them with the service.',
      WebhookCreate,
      (caller, input) => webhooks.create(caller, input)
    ),
    // A run's result was written after reading outside data: it comes back fenced, like other outside text.
    readTool('lilbot_webhooks_list', 'Your webhooks and their latest runs (results fenced as outside data), without their addresses.', z.object({}), async caller =>
      (await webhooks.list(caller)).map(hook => ({
        ...hook,
        runs: hook.runs.slice(0, RUNS_SHOWN).map(run => ({ ...run, result: fenced('webhook-run-result', run.result.slice(0, 500)) }))
      }))
    ),
    actionTool('lilbot_webhook_pause', 'Pause one of your webhooks: its address refuses events until you resume it.', one, async (caller, { id }) => ({
      id,
      ...(await webhooks.pause(caller, id, true))
    })),
    actionTool('lilbot_webhook_resume', 'Resume one of your paused webhooks.', one, async (caller, { id }) => ({ id, ...(await webhooks.pause(caller, id, false)) })),
    actionTool('lilbot_webhook_delete', 'Delete one of your webhooks: its address stops working at once. Remove it at the service too.', one, async (caller, { id }) => ({
      id,
      ...(await webhooks.delete(caller, id))
    })),
    actionTool('lilbot_webhook_new_address', 'Give one of your webhooks a new address; the old one stops working at once. Update the service.', one, (caller, { id }) =>
      webhooks.newAddress(caller, id)
    )
  ]
}
