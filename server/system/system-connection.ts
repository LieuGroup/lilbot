/** The MCP connections LilBot issues to engines: the profile-wide `lilbot_system` server (`system-mcp.ts`) and
 *  per-session scoped endpoints (`/engine/lilbot/session/mcp`) bound to a single limited run (review now; check,
 *  webhook and hand-off scopes plug into the same key and connection shape). */
import { createHash } from 'node:crypto'
import { connectionKey } from '../connections/connection-keys'
import type { McpConnection } from '../engines/mcp-connection'
import { inputSchema, type McpTool } from './mcp-tool'

/** Engines name the tools after this (Hermes: `mcp__lilbot_system__lilbot_about`). */
const SYSTEM_CONNECTION = 'lilbot_system'
export const SYSTEM_PATH = '/engine/lilbot/mcp'
export const SYSTEM_KEY_PURPOSE = 'lilbot-system'
/** Creating a bot waits for its first greeting. */
const TIMEOUT_SECONDS = 300

/** Short server name keeps engine-prefixed tool names well under the 64-character provider cap. */
const SESSION_MCP_NAME = 'lilbot'
export const SESSION_MCP_PATH = '/engine/lilbot/session/mcp'
export const SESSION_MCP_KEY_PURPOSE = 'lilbot-session-mcp'
export const MEMORY_REVIEW_TOOLS = ['lilbot_memory_recall', 'lilbot_memory_save', 'lilbot_memory_forget'] as const
const REVIEW_TIMEOUT_SECONDS = 120

/** Engines keep an MCP server's tool list until its settings change, so the URL names the tools as they
 *  are written now: a release that changes a tool makes every engine reconnect once, and a restart that
 *  changes nothing does not. Nothing here may differ between two starts of the same release. */
export const toolsVersion = (tools: McpTool[]) =>
  createHash('sha256')
    .update(JSON.stringify(tools.map(tool => [tool.name, tool.description, inputSchema(tool.input)])))
    .digest('hex')
    .slice(0, 12)

export function systemConnection(lilbotUrl: string, engineToken: string, botId: string, tools: readonly string[], version: string): McpConnection {
  return {
    name: SYSTEM_CONNECTION,
    url: `${lilbotUrl}${SYSTEM_PATH}?tools=${version}`,
    bearerToken: connectionKey(engineToken, SYSTEM_KEY_PURPOSE, botId),
    timeoutSeconds: TIMEOUT_SECONDS,
    tools
  }
}

/** Per-session bearer credential bound to this LilBot secret, bot, scope, and live run id. */
export const sessionMcpKey = (engineToken: string, botId: string, scope: string, runId: string) => connectionKey(engineToken, SESSION_MCP_KEY_PURPOSE, `${botId}:${scope}:${runId}`)

function sessionMcpConnection(
  lilbotUrl: string,
  engineToken: string,
  botId: string,
  scope: string,
  runId: string,
  tools: readonly string[],
  timeoutSeconds = REVIEW_TIMEOUT_SECONDS
): McpConnection {
  return {
    name: SESSION_MCP_NAME,
    url: `${lilbotUrl}${SESSION_MCP_PATH}?run=${encodeURIComponent(runId)}`,
    bearerToken: sessionMcpKey(engineToken, botId, scope, runId),
    timeoutSeconds,
    tools
  }
}

export function memoryReviewConnection(lilbotUrl: string, engineToken: string, botId: string, runId: string): McpConnection {
  return sessionMcpConnection(lilbotUrl, engineToken, botId, 'review', runId, MEMORY_REVIEW_TOOLS, REVIEW_TIMEOUT_SECONDS)
}
