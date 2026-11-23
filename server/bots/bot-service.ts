import type { ActivityEvent } from '../../shared/activity-schema'
import type { BotDeleteDefaults, BotDeleteInput } from '../../shared/bot-delete-schema'
import type { Bot, BotCreateInput, BotDetail, BotPrefsInput, BotUpdateInput, ModelProvider, Section } from '../../shared/bot-schema'
import type { ChatEvent } from '../../shared/chat-schema'
import { LilBotError } from '../../shared/lilbot-error'
import type { MemoryFact, MemoryWriteInput } from '../../shared/memory-schema'
import type { ActivityCursor, BotEngine, MemoryConnection } from '../engines/bot-engine'
import { asEngineRegistry, type EngineRegistry } from '../engines/engine-registry'
import type { MemoryService } from '../memory/memory-service'
import { BackgroundRuns } from './bot-background-runs'
import { BotConversations } from './bot-conversations'
import { BotCreation } from './bot-creation'
import { BotDeletion } from './bot-deletion'
import { type SwitchEngineOptions, switchBotEngine } from './bot-engine-switch'
import { BotMemory } from './bot-memory'
import type { BotPrefsStore } from './bot-prefs-store'
import { BotRuntimes } from './bot-runtimes'
import { SessionSettings } from './bot-session-settings'
import { BotSkills } from './bot-skills'
import type { BotRecord, BotStore } from './bot-store'
import type { Workspaces } from './workspaces'

export interface BotServiceOptions {
  /** Called whenever the bot list would look different to a client. */
  changed?: () => void
  /** Called whenever a fact was saved or forgotten through the app. */
  memoryChanged?: () => void
  history?: import('../history/history-service').HistoryService
  turnNotes?: import('./bot-conversations').TurnNotes // what LilBot adds to Oscar's next message (a webhook run's message)
  skills?: import('../skills/skills-service').SkillsService
  cleanupBot?: (botId: string) => void
  memoryConnection?: MemoryConnection
  /** LilBot-owned MCP connections given to every bot, by LilBot id. */
  connections?: (botId: string) => import('../engines/mcp-connection').McpConnection[]
  onConnectionsChanged?: (botId: string) => void
  systemNote?: (bot: BotRecord) => string
}

export class BotService {
  private history?: import('../history/history-service').HistoryService
  private conversations: BotConversations
  private library?: import('../skills/skills-service').SkillsService
  /** What the skills screens do; absent when there is no skills library. */
  skills?: BotSkills
  private deletion: BotDeletion
  private runtimes: BotRuntimes
  private changed: () => void
  private memoryChanged: () => void
  private creation: BotCreation
  private botMemory: BotMemory
  private sessions: SessionSettings
  private background: BackgroundRuns
  private engines: EngineRegistry

  constructor(
    engine: BotEngine | EngineRegistry,
    store: BotStore,
    private prefs: BotPrefsStore,
    private workspaces: Workspaces,
    private memory: MemoryService,
    options: BotServiceOptions = {}
  ) {
    this.engines = asEngineRegistry(engine)
    this.history = options.history
    this.library = options.skills
    this.runtimes = new BotRuntimes(store, this.engines, options.skills, options.memoryConnection, options.connections, options)
    this.changed = options.changed ?? (() => {})
    if (options.skills) this.skills = new BotSkills(options.skills, this.runtimes, this.engines, this.changed)
    this.sessions = new SessionSettings(this.engines, prefs, this.changed)
    this.background = new BackgroundRuns(this.runtimes, workspaces, this.sessions)
    this.conversations = new BotConversations(this.runtimes, prefs, workspaces, this.sessions, options.history, options.turnNotes)
    this.creation = new BotCreation(this, store)
    this.memoryChanged = options.memoryChanged ?? (() => {})
    this.deletion = new BotDeletion(
      this.runtimes,
      prefs,
      workspaces,
      memory,
      botId => {
        this.library?.forgetBot(botId)
        this.sessions.forget(botId)
        options.cleanupBot?.(botId)
      },
      () => {
        this.changed()
        this.memoryChanged()
      }
    )
    this.botMemory = new BotMemory(this.runtimes, memory, options.memoryConnection, this.memoryChanged)
  }
  deleteBot = (input: BotDeleteInput) => this.deletion.delete(input)
  deleteDefaults = () => this.runtimes.store.deleteDefaults()
  setDeleteDefaults = (input: BotDeleteDefaults) => this.runtimes.store.setDeleteDefaults(input)

  watchActivity(listener: (event: ActivityEvent) => void, cursor: ActivityCursor): () => void {
    return this.engines.watchActivity(
      async engineId => {
        await this.runtimes.load()
        return this.runtimes.store.list().filter(bot => bot.engineId === engineId)
      },
      event => !this.runtimes.store.deleted(event.botId) && listener(event),
      cursor,
      (engineId, nativeId, available) => void this.runtimes.runtimeAvailability(nativeId, available, engineId).then(this.changed, this.changed),
      (botId, chatId, event, key) => this.conversations.observe(botId, chatId, event, key)
    )
  }

  refreshConnections() {
    return this.runtimes.refreshConnections()
  }

  prepareRuntimes() {
    return this.runtimes.initialize(bots => this.primaryId(bots)).finally(this.changed)
  }

  async listBots(): Promise<Bot[]> {
    await this.runtimes.load()
    const identities = this.runtimes.store.list()
    const prefs = this.prefs.prefsFor(identities.map(bot => bot.id))
    const contexts = this.sessions.contextsFor()
    const primaryId = this.primaryId(identities)
    return identities.map(identity => ({
      ...this.identity(identity, contexts.get(identity.id)),
      runnable: this.runtimes.snapshot(identity) !== null,
      runtimePending: this.runtimes.pending(identity),
      isPrimary: identity.id === primaryId,
      prefs: prefs.get(identity.id)!,
      workspace: this.workspaces.pathFor(identity.id)
    }))
  }

  async getBot(botId: string): Promise<BotDetail> {
    const bot = await this.requireBot(botId)
    const state = this.runtimes.snapshot(bot)
    const skills = this.library?.list(botId).filter(s => !s.excluded) ?? []
    return {
      ...this.identity(bot),
      instructions: bot.instructions,
      memoryConnected: state?.memoryConnected ?? false,
      abilities: [
        ...(state?.abilities ?? []).filter(a => a.kind !== 'skill' || !skills.some(s => s.name === a.id)),
        ...skills.map(s => ({ kind: 'skill' as const, id: s.name, label: s.name, enabled: s.enabled }))
      ],
      runnable: state !== null,
      runtimePending: this.runtimes.pending(bot),
      ...this.own(bot)
    }
  }

  async createBot(input: BotCreateInput, id?: string, engineId?: string): Promise<Bot> {
    try {
      const identity = await this.runtimes.create(input, id, engineId)
      if (input.avatar) this.prefs.setPrefs(identity.id, { avatar: input.avatar })
      await this.workspaces.ensure(identity.id)
      await this.botMemory.connectNew(identity.id)
      return this.summary(identity)
    } finally {
      this.changed()
    }
  }
  switchEngine(botId: string, engineId: string, options?: SwitchEngineOptions) {
    return switchBotEngine(
      {
        engines: this.engines,
        runtimes: this.runtimes,
        prefs: this.prefs,
        workspaces: this.workspaces,
        sessions: this.sessions,
        botMemory: this.botMemory,
        history: this.history,
        changed: this.changed
      },
      botId,
      engineId,
      options
    )
  }

  async updateBot(input: BotUpdateInput): Promise<BotDetail> {
    const previous = await this.requireBot(input.botId)
    try {
      await this.runtimes.update(input)
      // Saved first; the open conversation follows from its next message.
      await this.sessions.apply(this.runtimes.store.get(input.botId), previous, input)
    } finally {
      this.changed()
    }
    return this.getBot(input.botId)
  }

  async setPrefs({ botId, ...patch }: BotPrefsInput): Promise<Bot> {
    const identity = await this.requireBot(botId)
    this.prefs.setPrefs(botId, patch)
    this.changed()
    return this.summary(identity)
  }

  /** The user adds a fact from the app. */
  async writeMemory(input: MemoryWriteInput): Promise<MemoryFact> {
    await this.requireBot(input.botId)
    const fact = this.memory.write({ ...input, author: 'user' })
    this.memoryChanged()
    return fact
  }

  forgetMemory(factId: string) {
    this.memory.forgetAsUser(factId)
    this.memoryChanged()
  }

  restoreMemory(factId: string) {
    this.memory.restore(factId)
    this.memoryChanged()
  }

  pauseMemory(factId: string, paused: boolean) {
    this.memory.setPaused(factId, paused)
    this.memoryChanged()
  }

  listMemory = (botId: string) => this.botMemory.list(botId)
  connectMemory = (botId: string, options?: { keepOwnNotes: boolean }) => this.botMemory.connect(botId, options)
  connectAllMemory = () => this.botMemory.connectAll()
  listModels = (engineId?: string): Promise<ModelProvider[]> => (engineId ? this.engines.require(engineId) : this.engines.defaultEngine).listModels()
  listSections = (): Section[] => this.prefs.sections()
  createSection(name: string): Section {
    const section = this.prefs.createSection(name)
    this.changed()
    return section
  }
  renameSection(sectionId: string, name: string): Section {
    const section = this.prefs.renameSection(sectionId, name)
    this.changed()
    return section
  }
  deleteSection(sectionId: string) {
    this.prefs.deleteSection(sectionId)
    this.changed()
  }

  openChat(botId: string, chatId: string | undefined, onEvent: (event: ChatEvent) => void, requireExisting = false) {
    return this.conversations.open(botId, chatId, onEvent, requireExisting)
  }

  newChat(botId: string, onEvent: (event: ChatEvent) => void) {
    return this.conversations.open(botId, null, onEvent)
  }

  historyReference(botId: string, chatId: string, item: Extract<import('../../shared/chat-schema').ChatItem, { kind: 'tool' }>, at: number) {
    this.history?.store.reference(botId, chatId, item, at)
  }

  async historyPage(botId: string, cursor?: string, limit?: number) {
    await this.requireBot(botId)
    if (!this.history) throw new LilBotError('unavailable', 'History is unavailable.')
    return this.history.store.page(botId, cursor, limit, this.prefs.mainChat(botId))
  }

  isMainChat(botId: string, chatId: string) {
    return this.prefs.mainChat(botId) === chatId
  }
  async runRoutine(botId: string, prompt: string, options: import('../engines/bot-engine').RoutineOptions) {
    const result = await this.background.routine(await this.requireBot(botId), prompt, options)
    // Deletion may have completed while the engine was running; do not restore its activity.
    await this.requireBot(botId)
    return result
  }

  private summary(bot: BotRecord): Bot {
    return { ...this.identity(bot), runnable: this.runtimes.snapshot(bot) !== null, runtimePending: this.runtimes.pending(bot), ...this.own(bot) }
  }

  private identity(bot: BotRecord, context = this.sessions.contextFor(bot.id)) {
    const { id, name, function: fn, model, reasoningEffort, isDefault, permissionMode } = bot
    const base = { id, name, function: fn, model, reasoningEffort, effectiveReasoningEffort: this.sessions.effectiveFor(id), isDefault, permissionMode }
    return context ? { ...base, context } : base
  }

  private own(identity: BotRecord): Pick<Bot, 'isPrimary' | 'prefs' | 'workspace'> {
    return { isPrimary: identity.id === this.primaryId(this.runtimes.store.list()), prefs: this.prefs.prefs(identity.id), workspace: this.workspaces.pathFor(identity.id) }
  }

  async createFromBot(callerId: string, input: import('./bot-creation').BotCreationInput) {
    return this.creation.create(await this.requireBot(callerId), input)
  }

  private primaryId(bots: BotRecord[]): string | undefined {
    return bots.find(bot => bot.id === this.prefs.primaryBot())?.id ?? bots.find(bot => bot.isDefault)?.id
  }

  async reviewMemory(botId: string, prompt: string, options: import('../engines/bot-engine').ReviewOptions): Promise<void> {
    return this.background.review(await this.requireBot(botId), prompt, options)
  }

  async setPrimary(botId: string): Promise<{ ok: true }> {
    await this.requireBot(botId)
    this.prefs.setPrimaryBot(botId)
    this.changed()
    return { ok: true }
  }

  requireBot(botId: string): Promise<BotRecord> {
    return this.runtimes.require(botId)
  }
}
