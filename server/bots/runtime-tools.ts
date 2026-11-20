/** What LilBot gives every bot's runtime besides its identity: computer tools, the shared skills and
 *  LilBot's own MCP connections. The engine skips what it has already applied. */
import { backgroundFailure } from '../background'
import type { BotEngine, McpConnection, MemoryConnection } from '../engines/bot-engine'
import { memoryRefusal } from '../memory/memory-safety'
import { files } from '../skills/skill-files'
import type { SkillsService } from '../skills/skills-service'
import type { BotRecord } from './bot-store'

export interface ToolSources {
  skills?: SkillsService
  connection?: MemoryConnection
  connections?: (botId: string) => McpConnection[]
}

export async function prepareTools(engine: BotEngine, bot: BotRecord, { skills, connection, connections }: ToolSources) {
  if (connection) {
    try {
      await engine.configureComputers?.(bot.engineBotId, { ...connection, botId: bot.id })
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown configuration error'
      const safeDetail = memoryRefusal(detail) ? 'Configuration error contained sensitive data; details withheld' : detail.slice(0, 500)
      console.error(`[computers] could not configure bot ${bot.id}; continuing without computer tools (${safeDetail})`)
    }
  }
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
  if (given?.length) await engine.prepareConnections?.(bot.engineBotId, given)
}

/** Gives each bot its connections again, for example after the shared T3 sign-in changed. */
export async function refreshConnections(engine: BotEngine, bots: BotRecord[], connections: (botId: string) => McpConnection[]) {
  let failed = false
  for (const bot of bots) {
    try {
      await engine.prepareConnections?.(bot.engineBotId, connections(bot.id))
    } catch {
      backgroundFailure('bot connections')
      failed = true
    }
  }
  if (failed) throw new Error('Connection refresh incomplete')
}
