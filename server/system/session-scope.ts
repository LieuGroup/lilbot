/** Single source of truth for which LilBot MCP tools each limited-session scope advertises (`tools/list`)
 *  and allows (`tools/call`). Keeps exact tool parity with `check-access.ts` and `run-access.ts`. */
import type { McpTool } from './mcp-tool'
import { RUN_TOOLS, runRefusalForChat, TOOL_GROUPS } from './run-access'
import type { SessionGrantScope } from './session-grants'

export const CHECK_REFUSED_READS = new Set(['lilbot_memory_list', 'lilbot_memory_recall', 'lilbot_history_search', 'lilbot_computers_list', 'lilbot_computer_request_read'])
const IN_CHECK = 'This session is a check: LilBot lets it read and give its verdict (lilbot_work with verdict), nothing else.'
export const REVIEW_TOOLS = ['lilbot_memory_recall', 'lilbot_memory_save', 'lilbot_memory_forget'] as const
const REVIEW_SET = new Set<string>(REVIEW_TOOLS)
const NARROWED_WEBHOOK_MSG = 'Only a webhook run sends its bot a message this way.'
const LIMITED_SKILL_WRITE = 'Limited sessions cannot write, patch, or delete skills.'

const toolReadOnly = (tool: McpTool, args: Record<string, unknown>) => (typeof tool.readOnly === 'function' ? tool.readOnly(args) : tool.readOnly)

/** Tools advertised by `tools/list` for a session grant. Every excluded tool is also refused on `tools/call`. */
export function scopedToolsFor(scope: SessionGrantScope, allTools: readonly McpTool[], t3Enabled = false): McpTool[] {
  switch (scope.kind) {
    case 'check':
      return allTools.filter(tool => {
        if (tool.name === 'lilbot_work') return true
        if (CHECK_REFUSED_READS.has(tool.name)) return false
        return tool.readOnly === true || typeof tool.readOnly === 'function'
      })
    case 'webhook':
    case 'narrowed': {
      const allowed = new Set<string>(scope.kind === 'webhook' ? RUN_TOOLS : RUN_TOOLS.filter(name => name !== 'lilbot_webhook_message'))
      for (const cap of scope.capabilities) {
        if (cap === 'coding' && !t3Enabled) continue
        for (const name of TOOL_GROUPS[cap] ?? []) allowed.add(name)
      }
      return allTools.filter(tool => allowed.has(tool.name))
    }
    case 'review':
      return allTools.filter(tool => REVIEW_SET.has(tool.name))
  }
}

/** Per-call scope refusal for a session-bound MCP endpoint, or null when the call is allowed. */
export function scopedCallRefusal(
  scope: SessionGrantScope,
  botId: string,
  tool: McpTool,
  rawArgs: unknown,
  beyondOwn: (botId: string, tool: string, args: unknown) => boolean,
  t3Enabled = false
): string | null {
  const args = (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs : {}) as Record<string, unknown>
  if (tool.name === 'lilbot_skill_manage') return LIMITED_SKILL_WRITE
  switch (scope.kind) {
    case 'check': {
      const allowed = (toolReadOnly(tool, args) && !CHECK_REFUSED_READS.has(tool.name)) || (tool.name === 'lilbot_work' && args.verdict !== undefined)
      return allowed ? null : IN_CHECK
    }
    case 'webhook':
      return runRefusalForChat(scope.capabilities, botId, tool.name, rawArgs, beyondOwn, t3Enabled)
    case 'narrowed':
      if (tool.name === 'lilbot_webhook_message') return NARROWED_WEBHOOK_MSG
      return runRefusalForChat(scope.capabilities, botId, tool.name, rawArgs, beyondOwn, t3Enabled)
    case 'review':
      return REVIEW_SET.has(tool.name) ? null : `A memory review session cannot use ${tool.name}.`
  }
}

export function scopeInstructions(scope: SessionGrantScope): string {
  switch (scope.kind) {
    case 'check':
      return 'Scoped LilBot check tools: read what you need to verify the claim and give your verdict with lilbot_work (verdict).'
    case 'webhook':
      return 'Scoped LilBot tools for this webhook run. Only tools permitted for this run are offered.'
    case 'narrowed':
      return 'Scoped LilBot tools for this narrowed session. Only tools permitted for this session are offered.'
    case 'review':
      return 'Scoped LilBot memory review tools: lilbot_memory_recall, lilbot_memory_save, and lilbot_memory_forget.'
  }
}
