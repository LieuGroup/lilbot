/** What a webhook run may do (#12, finding 3, Oscar's decision): narrow by default. It reads its own folder and its bot's
 *  own work items, updates them and sends its bot one message; its result is its report. Oscar adds capability groups per
 *  webhook (`webhooks.setCapabilities`), and a run gets exactly those on top.
 *
 *  Two layers. The engine maps the neutral webhook access scope to its own session controls (leaving outside servers and
 *  write/file tools out unless granted; `lilbot_workspace_read` reads instead). Because an engine may still attach
 *  built-in plug-ins and LilBot's own MCP server lists every tool, LilBot also refuses, at the call, whatever a run may
 *  not do (`webhook-callers.ts`, `system/run-access.ts`). `memory` stays out unless granted: with it a run could write
 *  facts every later turn reads, past both memory reviews. */
import type { WebhookCapability } from '../../shared/webhook-schema'
import type { RunAccessScope } from '../engines/bot-engine'

const SAYS: Record<WebhookCapability, string> = {
  web: 'read the web',
  shell: 'run commands or write files',
  computers: 'use computers',
  coding: 'code through T3 Code',
  memory: 'read and change memory',
  bots: 'manage bots',
  delegation: 'hand work to other bots',
  routines: 'manage routines',
  webhooks: 'manage webhooks'
}

const listed = (groups: WebhookCapability[], last: string) =>
  groups.map(group => SAYS[group]).reduce((text, item, i, all) => (i === 0 ? item : `${text}${i === all.length - 1 ? ` ${last} ` : ', '}${item}`), '')

export function webhookRunAccess(capabilities: WebhookCapability[], t3Enabled = false): { access: Extract<RunAccessScope, { kind: 'webhook' }>; prompt: string } {
  const active = (Object.keys(SAYS) as WebhookCapability[]).filter(group => t3Enabled || group !== 'coding')
  const granted = active.filter(group => capabilities.includes(group))
  const withheld = active.filter(group => !granted.includes(group))
  return {
    access: { kind: 'webhook', capabilities: granted },
    prompt: [
      'You can read the files in your own folder (lilbot_workspace_read), open, read and update your own work items (lilbot_work, lilbot_work_list) and send your bot one message (lilbot_webhook_message).',
      granted.length ? `Oscar also lets this webhook's runs ${listed(granted, 'and')}.` : '',
      withheld.length ? `You cannot ${listed(withheld, 'or')}: LilBot refuses those tools here.` : '',
      'Work without asking for approval.'
    ]
      .filter(Boolean)
      .join(' ')
  }
}
