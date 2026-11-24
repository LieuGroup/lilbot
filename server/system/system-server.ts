/** LilBot's own MCP server, assembled: the tools, the key check, and the connection every bot is given. */

import { systemSessionRefusal } from './check-access'
import { readsBeyondOwn } from './run-access'
import { createScopedMcp } from './scoped-mcp'
import type { SessionGrant } from './session-grants'
import { scopedToolsFor } from './session-scope'
import { systemConnection, toolsVersion } from './system-connection'
import type { SystemDeps } from './system-deps'
import { createSystemMcp } from './system-mcp'
import { aboutTools } from './tool-about'
import { botTools } from './tool-bots'
import { computerTools } from './tool-computers'
import { connectionTools } from './tool-connections'
import { delegationTools } from './tool-delegation'
import { goalTools } from './tool-goals'
import { groupTools } from './tool-groups'
import { historyTools } from './tool-history'
import { libraryTools } from './tool-library'
import { memoryTools } from './tool-memory'
import { rosterTools } from './tool-roster'
import { routineTools } from './tool-routines'
import { settingsTools } from './tool-settings'
import { skillTools } from './tool-skills'
import { webhookTools } from './tool-webhooks'
import { workTools } from './tool-work'
import { workspaceTools } from './tool-workspace'
import { createWorkerMcp } from './worker-mcp'

/** For an engine that shows an MCP server's instructions to the model (Hermes does not; the note carries the same pointers). */
const INSTRUCTIONS =
  "LilBot's own tools. They act as you, the calling bot. lilbot_about gives live facts about your system; lilbot_guide explains how each part works and the rules for changing LilBot. Nothing here deletes bots, computers or other bots' private facts: Oscar does that himself. You may delete your own webhooks and routines."

export function createSystemServer(deps: SystemDeps & { engineToken: string; port: number }) {
  const tools = [
    ...aboutTools(deps),
    ...botTools(deps),
    ...rosterTools(deps),
    ...memoryTools(deps),
    ...historyTools(deps),
    ...skillTools(deps),
    ...settingsTools(deps),
    ...delegationTools(deps),
    ...groupTools(deps),
    ...workTools(deps),
    ...goalTools(deps),
    ...libraryTools(deps),
    ...workspaceTools(deps),
    ...routineTools(deps),
    ...webhookTools(deps),
    ...connectionTools(deps),
    ...computerTools(deps)
  ]
  const version = toolsVersion(tools)
  const names = tools.map(tool => tool.name)
  const url = `http://127.0.0.1:${deps.port}`
  const beyondOwn = readsBeyondOwn(itemId => deps.work.store.get(itemId)?.ownerId)
  const refusal = systemSessionRefusal(tools, deps.checkSessions, deps.webhookRuns.callers, deps.calls, beyondOwn, Boolean(deps.t3Enabled))
  const scoped = deps.grants
    ? createScopedMcp({
        port: deps.port,
        grants: deps.grants,
        bots: () => deps.store.list(),
        tools,
        changes: deps.changes,
        beyondOwn,
        t3Enabled: Boolean(deps.t3Enabled),
        t3Forward: deps.t3Forward,
        reviewTracker: deps.reviewTracker
      })
    : undefined
  return {
    tools,
    handler: createSystemMcp({
      engineToken: deps.engineToken,
      port: deps.port,
      bots: () => deps.store.list(),
      tools,
      changes: deps.changes,
      instructions: INSTRUCTIONS,
      refusal,
      ...(deps.grants ? { hasLegacyUngrantedRun: (botId: string) => deps.grants!.hasLegacyUngrantedRun(botId) } : {})
    }),
    scoped,
    sessionConnections: (grant: SessionGrant) => {
      if (!deps.grants) throw new Error('Session grants unavailable.')
      const allowedNames = scopedToolsFor(grant.scope, tools, Boolean(deps.t3Enabled)).map(tool => tool.name)
      return deps.grants.connectionsFor(grant, url, allowedNames, Boolean(deps.t3Enabled))
    },
    workerMcp: createWorkerMcp(deps, tools),
    connection: (botId: string) => systemConnection(url, deps.engineToken, botId, names, version)
  }
}
