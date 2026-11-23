/** What LilBot gives every bot's runtime besides its identity: the shared skills and
 *  LilBot's own MCP connections. The engine skips what it has already applied. */
import { backgroundFailure } from '../background'
import type { BotEngine, MemoryConnection } from '../engines/bot-engine'
import type { EngineRegistry } from '../engines/engine-registry'
import type { McpConnection } from '../engines/mcp-connection'
import { files } from '../skills/skill-files'
import type { SkillsService } from '../skills/skills-service'
import type { BotRecord } from './bot-store'

interface ToolSources {
  skills?: SkillsService
  connection?: MemoryConnection
  connections?: (botId: string) => McpConnection[]
  onConnectionsChanged?: (botId: string) => void
}

export async function prepareTools(engine: BotEngine, bot: BotRecord, { skills, connection, connections, onConnectionsChanged }: ToolSources) {
  if (skills && connection) {
    // An engine whose switch is off is not imported from; the bot is marked only after an import, so switching on imports it.
    const includeEngineSkills = skills.engineIncluded(engine.id)
    if (includeEngineSkills && !skills.importedBot(bot.id)) {
      for (const path of engine.userSkillPaths?.(bot.engineBotId) ?? []) skills.import(engine.id, path, files(path))
      skills.markBotImported(bot.id)
    }
    await engine.configureSkills?.(bot.engineBotId, {
      root: skills.root,
      ...connection,
      botId: bot.id,
      disabled: skills.disabled(bot.id),
      names: skills.list(bot.id).map(s => s.name),
      includeEngineSkills
    })
  }
  const given = connections?.(bot.id)
  if (given?.length && (await engine.prepareConnections?.(bot.engineBotId, given))) onConnectionsChanged?.(bot.id)
}

/** Gives each bot its connections again, for example after a connection or sign-in changed. */
export async function refreshConnections(engines: EngineRegistry, bots: BotRecord[], connections: (botId: string) => McpConnection[], onChanged?: (botId: string) => void) {
  let failed = false
  for (const bot of bots) {
    const engine = engines.get(bot.engineId)
    if (!engine) continue
    try {
      if (await engine.prepareConnections?.(bot.engineBotId, connections(bot.id))) onChanged?.(bot.id)
    } catch {
      backgroundFailure('bot connections')
      failed = true
    }
  }
  if (failed) throw new Error('Connection refresh incomplete')
}
