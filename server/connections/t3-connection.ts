/** The one LilBot-owned connection every bot gets: T3 Code's MCP tools for coding work, reached
 *  through LilBot's bridge so every engine shares LilBot's single T3 sign-in. */
import type { McpConnection } from '../engines/mcp-connection'
import { connectionKey } from './connection-keys'

/** T3 Code is off by default; set `LILBOT_T3_ENABLED=1` to restore the T3 hand-off and skill. */
export const isT3Enabled = (env: Record<string, string | undefined> = process.env) => env.LILBOT_T3_ENABLED === '1'

/** Engines name the tools after this (Hermes: `mcp__lilbot_t3__t3_thread_launch`). */
export const T3_CONNECTION = 'lilbot_t3'
export const T3_BRIDGE_PATH = '/engine/t3/mcp'
/** T3 Code's MCP server on this machine. */
export const T3_DEFAULT_MCP_URL = 'http://127.0.0.1:3773/mcp'
/** Long enough for a `t3_thread_wait` the coding skill asks for (at most ten minutes). */
const T3_TIMEOUT_SECONDS = 900
/** Offered when the sign-in is missing, expired or revoked; its answer says how to renew. */
export const T3_STATUS_TOOL = 't3_connection_status'

/** What an outside caller needs for coding work. T3 hides inside-thread tools from outside callers
 *  itself; this list also leaves out deleting projects, themes, schedules and linking machines. */
export const T3_TOOLS = [
  'orchestrator_capabilities',
  't3_environment_links',
  't3_environment_read',
  't3_project_list',
  't3_project_read',
  't3_project_create',
  't3_project_clone',
  't3_thread_launch',
  't3_thread_list',
  't3_thread_search',
  't3_thread_read',
  't3_thread_wait',
  't3_thread_send',
  't3_thread_interrupt',
  't3_thread_organize',
  't3_thread_update',
  't3_pending_request',
  't3_queue',
  't3_worktree_list',
  'link_pull_request',
  'link_pull_requests',
  'list_thread_pull_requests',
  'read_pull_request_guide'
] as const

/** Names the bridge's per-bot key (`connection-keys.ts`); keys issued under it stay valid across releases. */
export const T3_KEY_PURPOSE = 't3-bridge'

/** `signIn` names the shared sign-in's state. Engines keep an MCP server's tool list until its settings
 *  change, so a new or lost sign-in changes the URL and every engine reconnects to the bridge. */
export function t3Connection(lilbotUrl: string, engineToken: string, botId: string, signIn = 'signed-out'): McpConnection {
  return {
    name: T3_CONNECTION,
    url: `${lilbotUrl}${T3_BRIDGE_PATH}?signin=${encodeURIComponent(signIn)}`,
    bearerToken: connectionKey(engineToken, T3_KEY_PURPOSE, botId),
    timeoutSeconds: T3_TIMEOUT_SECONDS,
    tools: [...T3_TOOLS, T3_STATUS_TOOL]
  }
}
