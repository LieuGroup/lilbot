/** Resolves LilBot ids to runtime ids. The database always wins over an engine's copy. */
import type { BotCreateInput, BotUpdateInput } from '../../shared/bot-schema'
import { LilBotError } from '../../shared/protocol'
import type { BotEngine, McpConnection, RuntimeState } from '../engines/bot-engine'
import type { BotRecord, BotStore } from './bot-store'
import { importBots } from './runtime-import'
import { Readiness } from './runtime-readiness'
import { prepareTools, refreshConnections } from './runtime-tools'
import { withNote } from './system-note'

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
    private connections?: (botId: string) => McpConnection[],
    options: { changed?: () => void; retryDelays?: readonly number[]; headStartMs?: number; systemNote?: (bot: BotRecord) => string } = {}
  ) {
    this.systemNote = options.systemNote
    this.readiness = new Readiness(
      bot => this.prepareAndState(bot),
      id => (this.store.exists(id) ? this.store.get(id) : undefined),
      { settled: options.changed, delays: options.retryDelays, headStartMs: options.headStartMs }
    )
  }

  private readiness: Readiness
  private systemNote?: (bot: BotRecord) => string

  private loading?: Promise<void>
  load(): Promise<void> {
    this.loading ??= importBots(this.store, this.engine).catch(error => {
      this.loading = undefined
      throw error
    })
    return this.loading
  }

  /** Prepares every bot, the one `first` names ahead of the rest. Resolves when each has settled, ready or
   *  unavailable and retrying; only the one-time import can reject. */
  initialize(first?: (bots: BotRecord[]) => string | undefined): Promise<void> {
    this.importing ??= (async () => {
      await this.load()
      const bots = this.store.list().filter(bot => bot.engineId === this.engine.id)
      await this.readiness.all(bots, first?.(bots))
    })().catch(error => {
      this.importing = undefined
      throw error
    })
    return this.importing
  }

  /** One bot prepared before use, ahead of the rest of the roster, then its identity and tools checked again.
   *  Rejects when its preparation fails. */
  async use(bot: BotRecord): Promise<RuntimeState> {
    await this.readiness.ensure(bot)
    return this.state(bot)
  }

  /** A deleted bot: stop preparing it and wait for a preparation already running. */
  release(botId: string) {
    this.states.delete(botId)
    this.prepared.delete(botId)
    return this.readiness.release(botId)
  }

  private async prepareAndState(bot: BotRecord) {
    try {
      await this.prepare(bot)
      await this.state(bot)
    } catch (error) {
      this.states.set(bot.id, null)
      throw error
    }
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
      await prepareTools(this.engine, bot, { skills: this.skills, connection: this.connection, connections: this.connections })
      // The engine runs the bot's instructions followed by the note about its system; LilBot's copy stays the user's text.
      const identity = this.systemNote ? { ...bot, instructions: withNote(bot.instructions, this.systemNote(bot)) } : bot
      const state = await this.engineFor(bot).applyIdentity(bot.engineBotId, identity)
      this.states.set(bot.id, state)
      return state
    } catch (error) {
      this.states.set(bot.id, null)
      throw error
    }
  }

  /** Gives every available bot its connections again, for example after the shared T3 sign-in changed. */
  async refreshConnections(): Promise<void> {
    if (this.connections)
      await refreshConnections(
        this.engine,
        this.store.list().filter(bot => bot.engineId === this.engine.id && this.states.get(bot.id)),
        this.connections
      )
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
    this.readiness.invalidate(bot.id)
    this.prepared.delete(bot.id)
    if (!available) this.states.set(bot.id, null)
    else await this.readiness.ensure(bot)
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
      reasoningEffort: null,
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
