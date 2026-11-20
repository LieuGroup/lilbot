/** The MCP connection every bot is given to LilBot's own server (`system-mcp.ts`), the same for every engine. */
import { createHash } from 'node:crypto'
import { connectionKey } from '../connections/connection-keys'
import type { McpConnection } from '../engines/bot-engine'
import { inputSchema, type McpTool } from './mcp-tool'

/** Engines name the tools after this (Hermes: `mcp__lilbot_system__lilbot_about`). */
const SYSTEM_CONNECTION = 'lilbot_system'
export const SYSTEM_PATH = '/engine/lilbot/mcp'
export const SYSTEM_KEY_PURPOSE = 'lilbot-system'
/** Creating a bot waits for its first greeting. */
const TIMEOUT_SECONDS = 300

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
