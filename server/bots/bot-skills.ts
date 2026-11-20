/** What the skills screens do: the library as one bot sees it, that bot's own switches, and each engine's
 *  "Include this engine's skills" switch, which applies to every bot. */
import { LilBotError } from '../../shared/protocol'
import type { SkillEngine } from '../../shared/skills-schema'
import { backgroundFailure } from '../background'
import type { BotEngine } from '../engines/bot-engine'
import type { SkillsService } from '../skills/skills-service'
import type { BotRuntimes } from './bot-runtimes'

export class BotSkills {
  constructor(
    private library: SkillsService,
    private runtimes: BotRuntimes,
    private engine: BotEngine,
    private changed: () => void
  ) {}

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

  /** The engine that runs the bots, then any other with a switch or imported skills. Bundled skills are counted over its available bots. */
  engines(): SkillEngine[] {
    const available = this.runtimes.bound().filter(bot => this.runtimes.snapshot(bot))
    const bundled = new Set(available.flatMap(bot => this.engine.bundledSkills?.(bot.engineBotId) ?? []))
    return this.engineIds().map(id => ({
      id,
      included: this.library.engineIncluded(id),
      imported: this.library.importedFrom(id),
      bundled: id === this.engine.id ? bundled.size : 0,
      alwaysOn: id === this.engine.id ? [...(this.engine.alwaysOnSkills ?? [])] : []
    }))
  }
  private engineIds = () => [...new Set([this.engine.id, ...this.library.engineIds()])]

  /** Saves the switch and answers at once; the bots prepare their tools again in the background, retrying as at start-up. */
  setEngine(engineId: string, included: boolean) {
    if (!this.engineIds().includes(engineId)) throw new LilBotError('unknown_engine', 'That engine is not known.')
    this.library.setEngineIncluded(engineId, included)
    if (engineId === this.engine.id) this.runtimes.reapplySkills().catch(() => backgroundFailure('skills switch'))
    return { ok: true as const }
  }
}
