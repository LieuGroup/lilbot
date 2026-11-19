/** Resolves LilBot ids to runtime ids. The database always wins over an engine's copy. */
import type { BotCreateInput, BotUpdateInput } from '../../shared/bot-schema'
import { LilBotError } from '../../shared/protocol'
import { backgroundFailure } from '../background'
import type { BotEngine, McpConnection, RuntimeState } from '../engines/bot-engine'
import { memoryRefusal } from '../memory/memory-safety'
import { files } from '../skills/skill-files'
import type { BotRecord, BotStore } from './bot-store'

export class BotRuntimes {
  private importing?: Promise<void>
  private prepared = new Set<string>()
  private states = new Map<string, RuntimeState | null>()
  constructor(
    readonly store: BotStore,
    private engine: BotEngine,
    private skills?: import('../skills/skills-service').SkillsService,
    private connection?: import('../engines/bot-engine').MemoryConnection,
    /** LilBot-owned MCP connections every bot gets (`server/connections/`). */
    private connections?: (botId: string) => McpConnection[]
  ) {}

  private loading?: Promise<void>
  load(): Promise<void> {
    if (!this.loading) {
      this.loading = (async () => {
        if (!this.store.imported(this.engine.id)) {
          const bots = await this.engine.importBots()
          this.store.import(
            this.engine.id,
            bots.map(bot => ({ ...bot, engineId: this.engine.id, engineBotId: bot.id }))
          )
        }
      })().catch(error => {
        this.loading = undefined
        throw error
      })
    }
    return this.loading
  }

  initialize(): Promise<void> {
    if (!this.importing) {
      this.importing = (async () => {
        await this.load()
        for (const bot of this.store.list().filter(bot => bot.engineId === this.engine.id)) {
          try {
            if (!this.store.exists(bot.id)) continue
            await this.prepare(bot)
            await this.state(bot)
          } catch (error) {
            this.states.set(bot.id, null)
            if (!(error instanceof LilBotError) || !['bot_not_found', 'runtime_unavailable', 'engine_unavailable', 'engine_timeout'].includes(error.code)) throw error
          }
        }
      })().catch(error => {
        this.importing = undefined
        throw error
      })
    }
    return this.importing
  }

  async require(id: string): Promise<BotRecord> {
    await this.load()
    return this.store.get(id)
  }

  engineFor(bot: BotRecord): BotEngine {
    if (bot.engineId !== this.engine.id) throw new LilBotError('runtime_unavailable', 'This bot’s engine is not available.')
    return this.engine
  }

  private async prepare(bot: BotRecord) {
    if (this.prepared.has(bot.id)) return
    this.validateMode(bot)
    await this.engineFor(bot).prepareRuntime?.(bot.engineBotId, bot)
    this.prepared.add(bot.id)
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
      if (this.connection) {
        try {
          await this.engine.configureComputers?.(bot.engineBotId, { ...this.connection, botId: bot.id })
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'Unknown configuration error'
          const safeDetail = memoryRefusal(detail) ? 'Configuration error contained sensitive data; details withheld' : detail.slice(0, 500)
          console.error(`[computers] could not configure bot ${bot.id}; continuing without computer tools (${safeDetail})`)
        }
      }
      if (this.skills && this.connection) {
        if (!this.skills.importedBot(bot.id)) {
          for (const path of this.engine.userSkillPaths?.(bot.engineBotId) ?? []) this.skills.import(path, files(path))
          this.skills.markBotImported(bot.id)
        }
        await this.engine.configureSkills?.(bot.engineBotId, {
          root: this.skills.root,
          ...this.connection,
          botId: bot.id,
          disabled: this.skills.disabled(bot.id),
          names: this.skills.list(bot.id).map(s => s.name)
        })
      }
      const connections = this.connections?.(bot.id)
      if (connections?.length) await this.engineFor(bot).prepareConnections?.(bot.engineBotId, connections)
      const state = await this.engineFor(bot).applyIdentity(bot.engineBotId, bot)
      this.states.set(bot.id, state)
      return state
    } catch (error) {
      this.states.set(bot.id, null)
      throw error
    }
  }

  /** Gives every current bot its connections again, for example after the shared T3 sign-in changed. */
  async refreshConnections(): Promise<void> {
    if (!this.connections) return
    let failed = false
    for (const bot of this.store.list().filter(bot => bot.engineId === this.engine.id && this.states.get(bot.id))) {
      try {
        await this.engine.prepareConnections?.(bot.engineBotId, this.connections(bot.id))
      } catch {
        backgroundFailure('bot connections')
        failed = true
      }
    }
    if (failed) throw new Error('Connection refresh incomplete')
  }

  snapshot(bot: BotRecord): RuntimeState | null {
    return this.states.get(bot.id) ?? null
  }

  memoryConnected(id: string) {
    const state = this.states.get(id)
    if (state) this.states.set(id, { ...state, memoryConnected: true })
  }

  async runtimeAvailability(nativeId: string, available: boolean) {
    await this.initialize()
    const bot = this.store.list().find(bot => bot.engineId === this.engine.id && bot.engineBotId === nativeId)
    if (!bot) return
    if (!available) this.states.set(bot.id, null)
    else {
      await this.state(bot)
      await this.prepare(bot)
    }
  }

  pending(bot: BotRecord): boolean {
    return bot.engineId === this.engine.id && !this.states.has(bot.id)
  }

  async create(input: BotCreateInput, id: string = crypto.randomUUID()): Promise<BotRecord> {
    await this.load()
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
    this.skills?.markBotImported(bot.id)
    const saved = this.store.get(bot.id)
    await this.state(saved)
    return saved
  }

  async update({ botId, ...patch }: BotUpdateInput): Promise<void> {
    const previous = await this.require(botId)
    const bot = { ...previous, ...patch }
    this.validateMode(bot)
    if (patch.model) await this.engineFor(bot).validateModel(patch.model)
    this.store.save(bot)
    if (bot.permissionMode !== previous.permissionMode) await this.engineFor(bot).prepareRuntime?.(bot.engineBotId, bot)
    await this.state(bot)
  }
}
