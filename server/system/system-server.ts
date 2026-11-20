/** LilBot's own MCP server, assembled: the tools, the key check, and the connection every bot is given. */

import { systemConnection, toolsVersion } from './system-connection'
import type { SystemDeps } from './system-deps'
import { createSystemMcp } from './system-mcp'
import { aboutTools } from './tool-about'
import { botTools } from './tool-bots'
import { delegationTools } from './tool-delegation'
import { groupTools } from './tool-groups'
import { memoryTools } from './tool-memory'
import { rosterTools } from './tool-roster'
import { settingsTools } from './tool-settings'
import { webhookTools } from './tool-webhooks'
import { workTools } from './tool-work'

/** For an engine that shows an MCP server's instructions to the model (Hermes does not; the note carries the same pointers). */
const INSTRUCTIONS =
  "LilBot's own tools. They act as you, the calling bot. lilbot_about gives live facts about your system; lilbot_guide explains how each part works and the rules for changing LilBot. Nothing here deletes bots, computers or other bots' private facts: Oscar does that himself. You may delete your own webhooks."

export function createSystemServer(deps: SystemDeps & { engineToken: string; port: number }) {
  const tools = [
    ...aboutTools(deps),
    ...botTools(deps),
    ...rosterTools(deps),
    ...memoryTools(deps),
    ...settingsTools(deps),
    ...delegationTools(deps),
    ...groupTools(deps),
    ...workTools(deps),
    ...webhookTools(deps)
  ]
  const version = toolsVersion(tools)
  const names = tools.map(tool => tool.name)
  const url = `http://127.0.0.1:${deps.port}`
  return {
    tools,
    handler: createSystemMcp({
      engineToken: deps.engineToken,
      port: deps.port,
      bots: () => deps.store.list(),
      tools,
      changes: deps.changes,
      instructions: INSTRUCTIONS
    }),
    connection: (botId: string) => systemConnection(url, deps.engineToken, botId, names, version)
  }
}
