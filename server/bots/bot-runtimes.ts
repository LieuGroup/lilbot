/** Resolves LilBot ids to runtime ids. The database always wins over an engine's copy. */
import type { BotCreateInput, BotUpdateInput } from '../../shared/bot-schema'
import { LilBotError } from '../../shared/lilbot-error'
import type { BotEngine, RuntimeState } from '../engines/bot-engine'
import { asEngineRegistry, type EngineRegistry } from '../engines/engine-registry'
import type { BotRecord, BotStore } from './bot-store'
import { importBots } from './runtime-import'
import { Readiness } from './runtime-readiness'
import { prepareTools, refreshConnections } from './runtime-tools'
import { withNote } from './system-note'

interface RuntimeOptions {
  changed?: () => void
  retryDelays?: readonly number[]
  headStartMs?: number
  systemNote?: (bot: BotRecord) => string
  onConnectionsChanged?: (botId: string) => void
}

export class BotRuntimes {
  private importing?: Promise<void>
  private prepared = new Set<string>()
  private states = new Map<string, RuntimeState | null>()
  private readiness: Readiness
  readonly engines: EngineRegistry
  constructor(
    readonly store: BotStore,
    engine: BotEngine | EngineRegistry,
    private skills?: import('../skills/skills-service').SkillsService,
    private connection?: import('../engines/bot-engine').MemoryConnection,
    private connections?: (botId: string) => import('../engines/mcp-connection').McpConnection[],
    private options: RuntimeOptions = {}
  ) {
    this.engines = asEngineRegistry(engine)
    this.readiness = new Readiness(
      bot => this.prepareAndState(bot),
      id => (this.store.exists(id) ? this.store.get(id) : undefined),
      { settled: options.changed, delays: options.retryDelays, headStartMs: options.headStartMs }
    )
  }

  private loading?: Promise<void>
  load(): Promise<void> {
    this.loading ??= Promise.all(this.engines.list().map(e => importBots(this.store, e))).then(
      () => {},
      error => {
        this.loading = undefined
        throw error
      }
    )
    return this.loading
  }

  /** Prepares every bot, the one `first` names ahead of the rest. */
  initialize(first?: (bots: BotRecord[]) => string | undefined): Promise<void> {
    this.importing ??= (async () => {
      await this.load()
      const bots = this.bound()
      await this.readiness.all(bots, first?.(bots))
    })().catch(error => {
      this.importing = undefined
      throw error
    })
    return this.importing
  }

  /** Every non-deleted bot whose engine is registered (optionally narrowed to one engine id). */
  bound = (engineId?: string) => this.store.list().filter(bot => (engineId ? bot.engineId === engineId : this.engines.has(bot.engineId)))

  /** A changed skills switch: each bound bot prepares its tools again, with the usual retries. */
  reapplySkills(engineId?: string): Promise<void> {
    const bots = this.bound(engineId)
    for (const bot of bots) this.readiness.invalidate(bot.id)
    return this.readiness.all(bots)
  }

  async use(bot: BotRecord): Promise<RuntimeState> {
    if (!this.engines.has(bot.engineId)) throw new LilBotError('runtime_unavailable', 'This bot’s engine is not available.')
    await this.readiness.ensure(bot)
    return this.state(bot)
  }
  release(botId: string) {
    this.states.delete(botId)
    this.prepared.delete(botId)
    return this.readiness.release(botId)
  }
  restoreState(botId: string, state: RuntimeState | null) {
    if (!state) return
    this.states.set(botId, state)
    this.prepared.add(botId)
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

  engineFor = (bot: BotRecord): BotEngine => this.engines.require(bot.engineId)
  engineIfAvailable = (bot: BotRecord): BotEngine | undefined => this.engines.get(bot.engineId)

  private async prepare(bot: BotRecord) {
    if (this.prepared.has(bot.id)) return
    this.validateMode(bot)
    await this.engineFor(bot).prepareRuntime?.(bot.engineBotId, bot)
    this.prepared.add(bot.id)
  }

  private validateMode(bot: Pick<BotRecord, 'engineId' | 'permissionMode'>) {
    const engine = this.engines.require(bot.engineId)
    if (!engine.supportedPermissionModes.includes(bot.permissionMode)) {
      throw new LilBotError('unsupported_permission_mode', `Engine ${engine.id} does not support permission mode "${bot.permissionMode}".`)
    }
  }

  async state(bot: BotRecord): Promise<RuntimeState> {
    this.validateMode(bot)
    try {
      const engine = this.engineFor(bot)
      const { skills, connection, connections } = this
      await prepareTools(engine, bot, { skills, connection, connections, onConnectionsChanged: this.options.onConnectionsChanged })
      const identity = this.options.systemNote ? { ...bot, instructions: withNote(bot.instructions, this.options.systemNote(bot)) } : bot
      const state = await engine.applyIdentity(bot.engineBotId, identity)
      this.states.set(bot.id, state)
      return state
    } catch (error) {
      this.states.set(bot.id, null)
      throw error
    }
  }

  async refreshConnections(): Promise<void> {
    const available = this.bound().filter(bot => this.states.get(bot.id))
    if (this.connections) await refreshConnections(this.engines, available, this.connections, this.options.onConnectionsChanged)
  }
  snapshot = (bot: BotRecord): RuntimeState | null => this.states.get(bot.id) ?? null
  memoryConnected(id: string) {
    const state = this.states.get(id)
    if (state) this.states.set(id, { ...state, memoryConnected: true })
  }
  async runtimeAvailability(nativeId: string, available: boolean, engineId?: string) {
    await this.initialize()
    const bot = this.store.list().find(bot => (engineId ? bot.engineId === engineId : this.engines.has(bot.engineId)) && bot.engineBotId === nativeId)
    if (!bot) return
    this.readiness.invalidate(bot.id)
    this.prepared.delete(bot.id)
    if (!available) this.states.set(bot.id, null)
    else await this.readiness.ensure(bot)
  }
  pending = (bot: BotRecord): boolean => this.engines.has(bot.engineId) && !this.states.has(bot.id)
  async create(input: BotCreateInput, id: string = crypto.randomUUID(), engineId?: string): Promise<BotRecord> {
    await this.load()
    if (this.store.deleted(id)) throw new LilBotError('bot_not_found', 'That bot has been deleted.')
    const existing = this.store.list().find(bot => bot.id === id)
    if (existing) return existing
    const engine = engineId ? this.engines.require(engineId) : this.engines.defaultEngine
    const model = input.model ?? this.store.list().find(b => b.engineId === engine.id && b.isDefault)?.model ?? null
    const bot: BotRecord = {
      id,
      name: input.name,
      function: input.function,
      instructions: input.instructions,
      model,
      isDefault: false,
      reasoningEffort: null,
      permissionMode: input.permissionMode ?? 'full-access',
      engineId: engine.id,
      engineBotId: ''
    }
    this.validateMode(bot)
    // Persist before asking the runtime. A failed creation leaves a recoverable, visible bot.
    bot.engineBotId = bot.id
    this.store.save(bot)
    const nativeId = await engine.createRuntime(bot)
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
