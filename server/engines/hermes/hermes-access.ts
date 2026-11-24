/** Maps LilBot's engine-neutral hidden-run access scopes to Hermes toolset lists and exact built-in allow-lists.
 *  Every limited scope includes `'skills'` and `'no_mcp'`: `'no_mcp'` excludes all profile-level MCP servers
 *  (`lilbot_system`, `lilbot_t3`, `lilbot_c_*`, user servers), while `'skills'` forces Hermes's explicit-toolset
 *  branch so composite fallback cannot inject `x_search` when xAI credentials exist. */
import type { WebhookCapability } from '../../../shared/webhook-schema'
import type { RunAccessScope } from '../bot-engine'

/** What a check session starts with on Hermes: reading the web, images, files and command output, and skills (for the
 *  lilbot-check skill), with `'no_mcp'` so only the session-bound check MCP endpoint attaches. */
const CHECK_TOOLSETS = ['web', 'vision', 'terminal', 'file', 'skills', 'no_mcp']
const NARROW_BASE = ['skills', 'no_mcp']
const REVIEW_TOOLSETS = ['skills', 'no_mcp']

/** Exact built-in tool names each Hermes toolset exposes (`hermes-agent/toolsets.py`), used by post-create
 *  verification to fail closed if Hermes attaches any tool outside the scope's explicit allow-list. */
const HERMES_BUILTIN_TOOLS: Readonly<Record<string, readonly string[]>> = {
  skills: ['skill_manage', 'skill_view', 'skills_list'],
  web: ['web_extract', 'web_search'],
  vision: ['vision_analyze'],
  terminal: ['process_manage', 'terminal'],
  file: ['patch', 'read_file', 'search_files', 'write_file'],
  code_execution: ['execute_code'],
  memory: ['memory'],
  no_mcp: []
}

/** Hermes built-in toolsets each webhook/narrowed capability group adds. LilBot-side groups and T3 (`coding`) arrive
 *  through the session-bound `editor.mcp_servers` list instead of profile MCP entries. */
const WEBHOOK_TOOLSETS: Record<WebhookCapability, readonly string[]> = {
  web: ['web'],
  shell: ['terminal', 'code_execution', 'file'],
  computers: [],
  coding: [],
  memory: ['memory'],
  bots: [],
  delegation: [],
  routines: [],
  webhooks: []
}

/** Whether a limited session on Hermes needs workspace-scoped file edits (`edit_policy: 'workspace_session'`).
 *  Check sessions stay at default `'ask'` (read-only: `write_file`/`patch` deny immediately without hanging);
 *  only `shell`-enabled webhook/narrowed runs receive workspace-scoped edits. */
export function limitedNeedsFileEdits(access?: RunAccessScope): boolean {
  if (!access || access === 'check' || access === 'review') return false
  return access.capabilities.includes('shell')
}

/** Toolsets Hermes should start a hidden session with; undefined means full access (every toolset). */
export function hermesToolsetsForRun(access?: RunAccessScope): string[] | undefined {
  if (!access) return undefined
  if (access === 'check') return [...CHECK_TOOLSETS]
  if (access === 'review') return [...REVIEW_TOOLSETS]
  if (access.kind !== 'webhook' && access.kind !== 'narrowed') throw new Error('Unknown run access scope')
  return [...new Set([...NARROW_BASE, ...access.capabilities.flatMap(group => (Object.hasOwn(WEBHOOK_TOOLSETS, group) ? WEBHOOK_TOOLSETS[group] : []))])]
}

/** Allowed built-in Hermes toolsets and tool names for a limited scope. */
export function allowedHermesBuiltins(access: RunAccessScope): { toolsets: Set<string>; tools: Set<string> } {
  const list = hermesToolsetsForRun(access) ?? []
  const toolsets = new Set(list)
  const tools = new Set<string>()
  for (const name of toolsets) for (const tool of HERMES_BUILTIN_TOOLS[name] ?? []) tools.add(tool)
  return { toolsets, tools }
}
