/** What the skills screens do: the library as one bot sees it, that bot's own switches, and each engine's
 *  "Include this engine's skills" switch, which applies to every bot. */
import { LilBotError } from '../../shared/lilbot-error'
import type { SkillEngine } from '../../shared/skills-schema'
import { backgroundFailure } from '../background'
import type { BotEngine } from '../engines/bot-engine'
import { asEngineRegistry, type EngineRegistry } from '../engines/engine-registry'
import type { SkillsService } from '../skills/skills-service'
import type { BotRuntimes } from './bot-runtimes'

export class BotSkills {
  private enginesRegistry: EngineRegistry
  constructor(
    private library: SkillsService,
    private runtimes: BotRuntimes,
    engine: BotEngine | EngineRegistry,
    private changed: () => void
  ) {
    this.enginesRegistry = asEngineRegistry(engine)
    this.library.setEngineSkillCheck(name => this.isEngineSkill(name))
  }

  async list(botId: string) {
    await this.runtimes.require(botId)
    return this.library.list(botId)
  }
  async read(botId: string, name: string) {
    await this.runtimes.require(botId)
    return this.library.read(name)
  }
  async setEnabled(botId: string, name: string, enabled: boolean) {
    const bot = await this.runtimes.require(botId)
    this.library.setEnabled(botId, name, enabled)
    await this.runtimes.state(bot)
    this.changed()
    return { ok: true as const }
  }

  /** Whether `name` is one of any registered engine's own skills (always-on or bundled). */
  isEngineSkill(name: string): boolean {
    for (const id of this.enginesRegistry.ids()) {
      const engine = this.enginesRegistry.get(id)
      if (!engine) continue
      if (engine.alwaysOnSkills?.some(skill => skill.name === name)) return true
      if (!engine.bundledSkills) continue
      const bound = this.runtimes.bound(id)
      const engineBotIds = bound.length > 0 ? bound.map(bot => bot.engineBotId) : ['default']
      for (const engineBotId of engineBotIds) {
        try {
          if (engine.bundledSkills(engineBotId).includes(name)) return true
        } catch {
          // Profiles whose environment cannot be inspected on this host (for example 'default' in dev) are skipped.
        }
      }
    }
    return false
  }

  /** Every registered engine, then any other with a switch or imported skills. Bundled skills are counted over its available bots. */
  engines(): SkillEngine[] {
    return this.engineIds().map(id => {
      const engine = this.enginesRegistry.get(id)
      const available = engine ? this.runtimes.bound(id).filter(bot => this.runtimes.snapshot(bot)) : []
      const bundled = new Set(available.flatMap(bot => engine?.bundledSkills?.(bot.engineBotId) ?? []))
      return {
        id,
        included: this.library.engineIncluded(id),
        imported: this.library.importedFrom(id),
        bundled: bundled.size,
        alwaysOn: [...(engine?.alwaysOnSkills ?? [])]
      }
    })
  }
  private engineIds = () => [...new Set([...this.enginesRegistry.ids(), ...this.library.engineIds()])]

  /** Saves the switch and answers at once; the bots prepare their tools again in the background, retrying as at start-up. */
  setEngine(engineId: string, included: boolean) {
    if (!this.engineIds().includes(engineId)) throw new LilBotError('unknown_engine', 'That engine is not known.')
    this.library.setEngineIncluded(engineId, included)
    if (this.enginesRegistry.has(engineId)) this.runtimes.reapplySkills(engineId).catch(() => backgroundFailure('skills switch'))
    return { ok: true as const }
  }
}
