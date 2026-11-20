import type { ActivityEvent } from '../../shared/activity-schema'
import type { BotDeleteDefaults, BotDeleteInput } from '../../shared/bot-delete-schema'
import type { Bot, BotCreateInput, BotDetail, BotPrefsInput, BotUpdateInput, ModelProvider, Section } from '../../shared/bot-schema'
import type { ChatEvent } from '../../shared/chat-schema'
import type { MemoryFact, MemoryWriteInput } from '../../shared/memory-schema'
import { LilBotError } from '../../shared/protocol'
import type { ActivityCursor, BotEngine, McpConnection, MemoryConnection } from '../engines/bot-engine'
import type { MemoryService } from '../memory/memory-service'
import { BotConversations } from './bot-conversations'
import { BotCreation } from './bot-creation'
import { BotDeletion } from './bot-deletion'
import { BotMemory } from './bot-memory'
import type { BotPrefsStore } from './bot-prefs-store'
import { BotRuntimes } from './bot-runtimes'
import type { BotRecord, BotStore } from './bot-store'
import type { Workspaces } from './workspaces'

export interface BotServiceOptions {
  /** Called whenever the bot list would look different to a client. */
  changed?: () => void
  /** Called whenever a fact was saved or forgotten through the app. */
  memoryChanged?: () => void
  history?: import('../history/history-service').HistoryService
  skills?: import('../skills/skills-service').SkillsService
  cleanupBot?: (botId: string) => void
  memoryConnection?: MemoryConnection
  /** LilBot-owned MCP connections given to every bot, by LilBot id. */
  connections?: (botId: string) => McpConnection[]
  /** The "about your system" note added to the instructions an engine runs (`system-note.ts`). */
  systemNote?: (bot: BotRecord) => string
}

export class BotService {
  private history?: import('../history/history-service').HistoryService
  private conversations: BotConversations
  private skills?: import('../skills/skills-service').SkillsService
  private deletion: BotDeletion
  private runtimes: BotRuntimes
  private changed: () => void
  private memoryChanged: () => void
  private creation: BotCreation
  private botMemory: BotMemory

  constructor(
    private engine: BotEngine,
    store: BotStore,
    private prefs: BotPrefsStore,
    private workspaces: Workspaces,
    private memory: MemoryService,
    options: BotServiceOptions = {}
  ) {
    this.history = options.history
    this.skills = options.skills
    this.runtimes = new BotRuntimes(store, engine, options.skills, options.memoryConnection, options.connections, { changed: options.changed, systemNote: options.systemNote })
    this.conversations = new BotConversations(this.runtimes, prefs, workspaces, options.history)
    this.creation = new BotCreation(this, store)
    this.changed = options.changed ?? (() => {})
    this.memoryChanged = options.memoryChanged ?? (() => {})
    this.deletion = new BotDeletion(
      this.runtimes,
      prefs,
      workspaces,
      memory,
      botId => {
        this.skills?.forgetBot(botId)
        options.cleanupBot?.(botId)
      },
      () => {
        this.changed()
        this.memoryChanged()
      }
    )
    this.botMemory = new BotMemory(this.runtimes, memory, options.memoryConnection, this.memoryChanged)
  }

  deleteBot(input: BotDeleteInput) {
    return this.deletion.delete(input)
  }
  deleteDefaults() {
    return this.runtimes.store.deleteDefaults()
  }
  setDeleteDefaults(input: BotDeleteDefaults) {
    return this.runtimes.store.setDeleteDefaults(input)
  }

  watchActivity(listener: (event: ActivityEvent) => void, cursor: ActivityCursor): () => void {
    return (
      this.engine.watchActivity?.(
        async () => {
          await this.runtimes.load()
          return this.runtimes.store.list().filter(bot => bot.engineId === this.engine.id)
        },
        event => {
          if (!this.runtimes.store.deleted(event.botId)) listener(event)
        },
        cursor,
        (nativeId, available) => {
          void this.runtimes
            .runtimeAvailability(nativeId, available)
            .then(this.changed)
            .catch(() => this.changed())
        },
        (botId, chatId, event, key) => this.history?.record(botId, chatId, event, key)
      ) ?? (() => {})
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
    const primaryId = this.primaryId(identities)
    return identities.map(identity => ({
      ...this.identity(identity),
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
    const skills = this.skills?.list(botId) ?? []
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

  async createBot(input: BotCreateInput, id?: string): Promise<Bot> {
    try {
      const identity = await this.runtimes.create(input, id)
      if (input.avatar) this.prefs.setPrefs(identity.id, { avatar: input.avatar })
      await this.workspaces.ensure(identity.id)
      await this.botMemory.connectNew(identity.id)
      return this.summary(identity)
    } finally {
      this.changed()
    }
  }

  async updateBot(input: BotUpdateInput): Promise<BotDetail> {
    try {
      await this.runtimes.update(input)
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

  listMemory(botId: string) {
    return this.botMemory.list(botId)
  }
  connectMemory(botId: string, options?: { keepOwnNotes: boolean }) {
    return this.botMemory.connect(botId, options)
  }
  connectAllMemory() {
    return this.botMemory.connectAll()
  }

  listModels(): Promise<ModelProvider[]> {
    return this.engine.listModels()
  }

  listSections(): Section[] {
    return this.prefs.sections()
  }

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
    return this.history.store.page(botId, cursor, limit)
  }

  isMainChat(botId: string, chatId: string) {
    return this.prefs.mainChat(botId) === chatId
  }
  async runRoutine(botId: string, prompt: string, options: import('../engines/bot-engine').RoutineOptions) {
    const bot = await this.requireBot(botId)
    await this.runtimes.use(bot)
    const result = await this.runtimes.engineFor(bot).runRoutine(bot.engineBotId, prompt, { ...options, workspace: await this.workspaces.ensure(botId) })
    // Deletion may have completed while the engine was running; do not restore its activity.
    await this.requireBot(botId)
    return result
  }

  private summary(bot: BotRecord): Bot {
    return { ...this.identity(bot), runnable: this.runtimes.snapshot(bot) !== null, runtimePending: this.runtimes.pending(bot), ...this.own(bot) }
  }

  private identity(bot: BotRecord) {
    const { id, name, function: fn, model, isDefault, permissionMode } = bot
    return { id, name, function: fn, model, isDefault, permissionMode }
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
    const bot = await this.requireBot(botId)
    try {
      await this.runtimes.use(bot)
      return await this.runtimes.engineFor(bot).reviewMemory(bot.engineBotId, prompt, options)
    } catch (error) {
      // The app still owns this bot. A lost runtime must not discard its waiting turns.
      if (error instanceof LilBotError && error.code === 'bot_not_found') throw new LilBotError('runtime_unavailable', 'This bot’s runtime is missing.')
      throw error
    }
  }

  async setPrimary(botId: string): Promise<{ ok: true }> {
    await this.requireBot(botId)
    this.prefs.setPrimaryBot(botId)
    this.changed()
    return { ok: true }
  }

  async listSkills(botId: string) {
    await this.requireBot(botId)
    return this.skills?.list(botId) ?? []
  }
  async readSkill(botId: string, name: string) {
    await this.requireBot(botId)
    return this.skills!.read(name)
  }
  async setSkill(botId: string, name: string, enabled: boolean) {
    const bot = await this.requireBot(botId)
    this.skills!.setEnabled(botId, name, enabled)
    await this.runtimes.state(bot)
    this.changed()
    return { ok: true as const }
  }
  requireBot(botId: string): Promise<BotRecord> {
    return this.runtimes.require(botId)
  }
}
