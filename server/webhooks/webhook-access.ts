/** What a webhook run may do (#12, finding 3, Oscar's decision): narrow by default. It reads its own folder and its bot's
 *  own work items, updates them and sends its bot one message; its result is its report. Oscar adds capability groups per
 *  webhook (`webhooks.setCapabilities`), and a run gets exactly those on top.
 *
 *  Two layers. The engine starts the run's session with only `toolsets`: naming LilBot's own MCP server leaves every
 *  other server out (T3 included), and the engine's file tools are left out because reading comes with writing there
 *  (`lilbot_workspace_read` reads instead). Hermes adds plug-in toolsets back to any session (the computers and skills
 *  plug-ins), and LilBot's own server lists every tool, so LilBot also refuses, at the call, whatever a run may not do
 *  (`webhook-callers.ts`, `system/run-access.ts`). `memory` stays out unless granted: with it a run could write facts
 *  every later turn reads, past both memory reviews. */
import type { WebhookCapability } from '../../shared/webhook-schema'

const NARROW = ['lilbot_system']
/** The engine's toolsets each group adds. The LilBot-side groups add none: their tools are on LilBot's own server. */
const ENGINE_TOOLSETS: Record<WebhookCapability, string[]> = {
  web: ['web'],
  shell: ['terminal', 'code_execution', 'file'],
  computers: ['lilbot_computers'],
  coding: ['lilbot_t3'],
  memory: ['memory'],
  bots: [],
  delegation: [],
  routines: [],
  webhooks: []
}
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

export function webhookRunAccess(capabilities: WebhookCapability[]) {
  const granted = Object.keys(SAYS).filter(group => capabilities.includes(group as WebhookCapability)) as WebhookCapability[]
  const withheld = (Object.keys(SAYS) as WebhookCapability[]).filter(group => !granted.includes(group))
  return {
    toolsets: [...new Set([...NARROW, ...granted.flatMap(group => ENGINE_TOOLSETS[group])])],
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
