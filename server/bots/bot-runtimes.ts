/** Resolves LilBot ids to runtime ids. The database always wins over an engine's copy. */
import type { BotCreateInput, BotUpdateInput } from '../../shared/bot-schema'
import { LilBotError } from '../../shared/protocol'
import type { BotEngine, RuntimeState } from '../engines/bot-engine'
import type { BotRecord, BotStore } from './bot-store'

export class BotRuntimes {
  private importing?: Promise<void>
  constructor(
    readonly store: BotStore,
    private engine: BotEngine
  ) {}

  initialize(): Promise<void> {
    if (this.store.imported(this.engine.id)) return Promise.resolve()
    if (!this.importing) {
      this.importing = this.engine
        .importBots()
        .then(bots => {
          this.store.import(
            this.engine.id,
            bots.map(bot => ({ ...bot, engineId: this.engine.id, engineBotId: bot.id }))
          )
        })
        .finally(() => {
          this.importing = undefined
        })
    }
    return this.importing
  }

  async require(id: string): Promise<BotRecord> {
    await this.initialize()
    return this.store.get(id)
  }

  engineFor(bot: BotRecord): BotEngine {
    if (bot.engineId !== this.engine.id) throw new LilBotError('runtime_unavailable', 'This bot’s engine is not available.')
    return this.engine
  }

  async state(bot: BotRecord): Promise<RuntimeState> {
    return this.engineFor(bot).applyIdentity(bot.engineBotId, bot)
  }

  async optionalState(bot: BotRecord): Promise<RuntimeState | null> {
    try {
      return await this.state(bot)
    } catch (error) {
      if (error instanceof LilBotError && ['bot_not_found', 'runtime_unavailable', 'engine_unavailable', 'engine_timeout'].includes(error.code)) return null
      throw error
    }
  }

  async available(bot: BotRecord): Promise<boolean> {
    return (await this.optionalState(bot)) !== null
  }

  async create(input: BotCreateInput, id: string = crypto.randomUUID()): Promise<BotRecord> {
    await this.initialize()
    const existing = this.store.list().find(bot => bot.id === id)
    if (existing) return existing
    const bot: BotRecord = {
      id,
      name: input.name,
      function: input.function,
      instructions: input.instructions,
      model: input.model ?? this.store.list().find(bot => bot.isDefault)?.model ?? null,
      isDefault: false,
      engineId: this.engine.id,
      engineBotId: ''
    }
    // Persist before asking the runtime. A failed creation leaves a recoverable, visible bot.
    bot.engineBotId = bot.id
    this.store.save(bot)
    const nativeId = await this.engine.createRuntime(bot)
    if (nativeId !== bot.engineBotId) this.store.bind(bot.id, nativeId)
    return this.store.get(bot.id)
  }

  async update({ botId, ...patch }: BotUpdateInput): Promise<BotRecord> {
    const bot = { ...(await this.require(botId)), ...patch }
    this.store.save(bot)
    await this.state(bot)
    return bot
  }
}
