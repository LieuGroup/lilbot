/** Maps LilBot's engine-neutral hidden-run access scopes to Hermes toolset lists. */
import type { WebhookCapability } from '../../../shared/webhook-schema'
import type { RunAccessScope } from '../bot-engine'

/** What a check session starts with on Hermes: reading the web, images, files and command output, skills (for the
 *  lilbot-check skill) and LilBot's own MCP server (which refuses writes and memory). Not memory, scheduling,
 *  delegation or coding. Files and the terminal can still write: read-only stays an instruction there. */
const CHECK_TOOLSETS = ['web', 'vision', 'terminal', 'file', 'skills', 'lilbot_system']

const WEBHOOK_NARROW = ['lilbot_system']

/** Hermes toolsets each webhook capability group adds. LilBot-side groups add none: their tools are on LilBot's own server. */
const WEBHOOK_TOOLSETS: Record<WebhookCapability, readonly string[]> = {
  web: ['web'],
  shell: ['terminal', 'code_execution', 'file'],
  computers: [],
  coding: ['lilbot_t3'],
  memory: ['memory'],
  bots: [],
  delegation: [],
  routines: [],
  webhooks: []
}

/** Toolsets Hermes should start a hidden session with; undefined means full access (every toolset). */
export function hermesToolsetsForRun(access?: RunAccessScope): string[] | undefined {
  if (!access) return undefined
  if (access === 'check') return [...CHECK_TOOLSETS]
  if (access.kind !== 'webhook') throw new Error('Unknown run access scope')
  return [...new Set([...WEBHOOK_NARROW, ...access.capabilities.flatMap(group => (Object.hasOwn(WEBHOOK_TOOLSETS, group) ? WEBHOOK_TOOLSETS[group] : []))])]
}
