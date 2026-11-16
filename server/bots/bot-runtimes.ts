/** Resolves LilBot ids to runtime ids. The database always wins over an engine's copy. */
import type { BotCreateInput, BotUpdateInput } from '../../shared/bot-schema'
import { LilBotError } from '../../shared/protocol'
import type { BotEngine, RuntimeState } from '../engines/bot-engine'
import type { BotRecord, BotStore } from './bot-store'

export class BotRuntimes {
  private importing?: Promise<void>
  private initialized = false
  private prepared = new Set<string>()
  private states = new Map<string, RuntimeState | null>()
  constructor(
    readonly store: BotStore,
    private engine: BotEngine
  ) {}

  initialize(): Promise<void> {
    if (this.initialized) return Promise.resolve()
    if (!this.importing) {
      this.importing = (async () => {
        if (!this.store.imported(this.engine.id)) {
          const bots = await this.engine.importBots()
          this.store.import(
            this.engine.id,
            bots.map(bot => ({ ...bot, engineId: this.engine.id, engineBotId: bot.id }))
          )
        }
        for (const bot of this.store.list()) {
          try {
            await this.state(bot)
            if (!this.prepared.has(bot.id)) {
              this.validateMode(bot)
              await this.engineFor(bot).prepareRuntime?.(bot.engineBotId, bot)
              this.prepared.add(bot.id)
            }
          } catch (error) {
            this.states.set(bot.id, null)
            if (!(error instanceof LilBotError) || !['bot_not_found', 'runtime_unavailable', 'engine_unavailable', 'engine_timeout'].includes(error.code)) throw error
          }
        }
        this.initialized = true
      })().finally(() => {
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

  private validateMode(bot: Pick<BotRecord, 'permissionMode'>) {
    if (!this.engine.supportedPermissionModes.includes(bot.permissionMode)) {
      throw new LilBotError(
        'unsupported_permission_mode',
        `Engine ${this.engine.id} does not support permission mode "${bot.permissionMode}". Supported modes: ${this.engine.supportedPermissionModes.join(', ') || 'none'}.`
      )
    }
  }

  async state(bot: BotRecord): Promise<RuntimeState> {
    this.validateMode(bot)
    try {
      const state = await this.engineFor(bot).applyIdentity(bot.engineBotId, bot)
      this.states.set(bot.id, state)
      return state
    } catch (error) {
      this.states.set(bot.id, null)
      throw error
    }
  }

  async optionalState(bot: BotRecord): Promise<RuntimeState | null> {
    await this.initialize()
    return this.states.get(bot.id) ?? null
  }

  memoryConnected(id: string) {
    const state = this.states.get(id)
    if (state) this.states.set(id, { ...state, memoryConnected: true })
  }

  async runtimeAvailability(nativeId: string, available: boolean) {
    const bot = this.store.list().find(bot => bot.engineId === this.engine.id && bot.engineBotId === nativeId)
    if (!bot) return
    if (!available) this.states.set(bot.id, null)
    else {
      await this.state(bot)
      if (!this.prepared.has(bot.id)) {
        await this.engineFor(bot).prepareRuntime?.(bot.engineBotId, bot)
        this.prepared.add(bot.id)
      }
    }
  }

  async available(bot: BotRecord): Promise<boolean> {
    return (await this.optionalState(bot)) !== null
  }

  async create(input: BotCreateInput, id: string = crypto.randomUUID()): Promise<BotRecord> {
    await this.initialize()
    if (this.store.deleted(id)) throw new LilBotError('bot_not_found', 'That bot has been deleted.')
    const existing = this.store.list().find(bot => bot.id === id)
    if (existing) return existing
    const bot: BotRecord = {
      id,
      name: input.name,
      function: input.function,
      instructions: input.instructions,
      model: input.model ?? this.store.list().find(bot => bot.isDefault)?.model ?? null,
      isDefault: false,
      permissionMode: input.permissionMode ?? 'full-access',
      engineId: this.engine.id,
      engineBotId: ''
    }
    this.validateMode(bot)
    // Persist before asking the runtime. A failed creation leaves a recoverable, visible bot.
    bot.engineBotId = bot.id
    this.store.save(bot)
    const nativeId = await this.engine.createRuntime(bot)
    if (nativeId !== bot.engineBotId) this.store.bind(bot.id, nativeId)
    const saved = this.store.get(bot.id)
    await this.state(saved)
    return saved
  }

  async update({ botId, ...patch }: BotUpdateInput): Promise<BotRecord> {
    const previous = await this.require(botId)
    const bot = { ...previous, ...patch }
    this.validateMode(bot)
    this.store.save(bot)
    if (bot.permissionMode !== previous.permissionMode) await this.engineFor(bot).prepareRuntime?.(bot.engineBotId, bot)
    await this.state(bot)
    return bot
  }
}
