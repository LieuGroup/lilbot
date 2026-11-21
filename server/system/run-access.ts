/** Which of LilBot's own tools a webhook run may call (#12, finding 3: Oscar's decision). A narrow run reads its bot's
 *  folder and its own work items, updates them and messages its own bot; every other tool belongs to a capability group
 *  Oscar can add to one webhook, or is refused to every run. Every tool is listed here (a test checks), so a new tool
 *  needs that decision. */
import type { WebhookCapability } from '../../shared/webhook-schema'
import type { WebhookCallers } from '../webhooks/webhook-callers'

export const RUN_TOOLS = ['lilbot_guide', 'lilbot_work', 'lilbot_work_list', 'lilbot_webhook_message', 'lilbot_workspace_read']

export const TOOL_GROUPS: Partial<Record<WebhookCapability, string[]>> = {
  // The other bots, computers, T3 and deploy state and the change log: a run Oscar lets manage bots has the roster anyway.
  bots: [
    'lilbot_about',
    'lilbot_bots_list',
    'lilbot_bot_read',
    'lilbot_bot_create',
    'lilbot_bot_edit',
    'lilbot_models_list',
    'lilbot_primary_set',
    'lilbot_roster_set',
    'lilbot_section_create',
    'lilbot_unread_set',
    'lilbot_delete_defaults_get',
    'lilbot_delete_defaults_set'
  ],
  delegation: ['lilbot_bots_list', 'lilbot_delegate', 'lilbot_delegation', 'lilbot_group'],
  computers: ['lilbot_status'],
  coding: ['lilbot_status'],
  memory: ['lilbot_memory_list', 'lilbot_memory_pause', 'lilbot_memory_restore', 'lilbot_memory_expiry'],
  routines: ['lilbot_routine', 'lilbot_routines_list'],
  // A run can only give the Library a file it could write.
  shell: ['lilbot_give_file'],
  webhooks: ['lilbot_webhook', 'lilbot_webhooks_list']
}

/** In no group: Oscar's list names the work board, not goals. */
export const NO_RUN_TOOLS = ['lilbot_goal']

const groupsOf = (tool: string) => (Object.keys(TOOL_GROUPS) as WebhookCapability[]).filter(group => TOOL_GROUPS[group]?.includes(tool))

/** Why a session that may do `allowed` (null: not a webhook run's) may not use a tool in `groups`, or null when it may.
 *  The T3 bridge uses it for its tools, all in `coding`, and the engine API for plug-in tools. */
export function refusalFor(allowed: WebhookCapability[] | null, tool: string, groups: WebhookCapability[]): string | null {
  if (allowed === null || groups.some(group => allowed.includes(group))) return null
  return `A webhook run cannot use ${tool}: webhook runs read their folder, report on their own work items and leave their bot one message (lilbot_webhook_message). ${
    groups.length ? `Oscar can let this webhook's runs use "${groups[0]}" tools in the app.` : 'No webhook run can use it.'
  } If you are not in a webhook run, make the call again from your own conversation.`
}

/** Whether a `lilbot_work_list` call reads beyond the calling bot's own items: every bot's, goals, or another bot's item.
 *  `owner` gives an item's owner. */
export const readsBeyondOwn = (owner: (itemId: string) => string | undefined) => (botId: string, tool: string, args: unknown) => {
  if (tool !== 'lilbot_work_list') return false
  const { mine, goals, goalId, itemId } = (args ?? {}) as { mine?: unknown; goals?: unknown; goalId?: unknown; itemId?: unknown }
  return mine === false || Boolean(goals) || goalId !== undefined || (itemId !== undefined && owner(String(itemId)) !== botId)
}

/** The same for LilBot's own tools, matched to the call's own start. The narrow ones are allowed without waiting, except
 *  a work-board read beyond the bot's own items, which no webhook run may make (Oscar's decision, whatever its groups). */
export async function runRefusal(callers: WebhookCallers, botId: string, tool: string, args: unknown, beyondOwn: (botId: string, tool: string, args: unknown) => boolean) {
  if (!RUN_TOOLS.includes(tool)) return refusalFor(await callers.forCall(botId, tool, args), tool, groupsOf(tool))
  if (!beyondOwn(botId, tool, args) || (await callers.forCall(botId, tool, args)) === null) return null
  return 'A webhook run reads only its own work items: list them without mine false, goals or goalId, or open one of its own. If you are not in a webhook run, make the call again from your own conversation.'
}
