/** Wires LilBot's engine-neutral prompt assembler and private per-bot prompt store into `BotService`. */
import type { BotRecord, BotStore } from './bots/bot-store'
import type { BotPromptSource } from './bots/runtime-tools'
import type { Workspaces } from './bots/workspaces'
import type { EngineRegistry } from './engines/engine-registry'
import { assembleBotPrompt } from './prompts/prompt-assembler'
import { isPromptOwnershipEnabled, PromptStore } from './prompts/prompt-store'
import { dateLine } from './prompts/turn-date'
import type { SkillsService } from './skills/skills-service'

export interface PromptController {
  source: BotPromptSource
  refreshAll: () => void
  forgetBot: (botId: string) => void
}

export function createPromptController(deps: {
  dataDir: string
  engines: EngineRegistry
  workspaces: Workspaces
  skills: SkillsService
  store: BotStore
  systemNote: (bot: BotRecord) => string
  enabled?: boolean
}): PromptController {
  const store = new PromptStore(deps.dataDir)
  const enabled = deps.enabled ?? isPromptOwnershipEnabled(process.env)

  const write = (bot: BotRecord): string => {
    const offered = deps.skills
      .list(bot.id)
      .filter(skill => skill.enabled && !skill.excluded)
      .map(skill => ({ name: skill.name, description: skill.description }))
    const assembled = assembleBotPrompt({
      botId: bot.id,
      botName: bot.name,
      workspace: deps.workspaces.pathFor(bot.id),
      instructions: bot.instructions,
      systemNote: deps.systemNote(bot),
      engineTuning: deps.engines.get(bot.engineId)?.promptTuning,
      skills: offered
    })
    return store.write(bot.id, assembled)
  }

  return {
    source: { enabled, write, pathFor: botId => store.pathFor(botId), ...(enabled ? { turnLine: () => dateLine() } : {}) },
    refreshAll: () => {
      if (!enabled) return
      for (const bot of deps.store.list()) {
        try {
          write(bot)
        } catch {
          console.error('[prompt] could not refresh prompt file; keeping previous copy')
        }
      }
    },
    forgetBot: botId => store.forgetBot(botId)
  }
}
