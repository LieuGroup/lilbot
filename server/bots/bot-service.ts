import type { Bot, BotCreateInput, BotDetail, BotPrefsInput, BotUpdateInput, ModelProvider, Section } from '../../shared/bot-schema'
import type { ChatEvent } from '../../shared/chat-schema'
import type { MemoryFact, MemoryWriteInput } from '../../shared/memory-schema'
import { LilBotError } from '../../shared/protocol'
import type { BotEngine, MemoryConnection, OpenChat } from '../engines/bot-engine'
import type { MemoryService } from '../memory/memory-service'
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
  /** Where engine adapters reach LilBot's memory. Without it, bots are not connected to memory. */
  memoryConnection?: MemoryConnection
}

export class BotService {
  private runtimes: BotRuntimes
  private changed: () => void
  private memoryChanged: () => void
  private botMemory: BotMemory

  constructor(
    private engine: BotEngine,
    store: BotStore,
    private prefs: BotPrefsStore,
    private workspaces: Workspaces,
    private memory: MemoryService,
    options: BotServiceOptions = {}
  ) {
    this.runtimes = new BotRuntimes(store, engine)
    this.changed = options.changed ?? (() => {})
    this.memoryChanged = options.memoryChanged ?? (() => {})
    this.botMemory = new BotMemory(this.runtimes, memory, options.memoryConnection, this.memoryChanged)
  }

  async listBots(): Promise<Bot[]> {
    await this.runtimes.initialize()
    const identities = this.runtimes.store.list()
    const prefs = this.prefs.prefsFor(identities.map(bot => bot.id))
    const primaryId = this.primaryId(identities)
    return Promise.all(
      identities.map(async identity => ({
        ...this.identity(identity),
        runnable: await this.runtimes.available(identity),
        isPrimary: identity.id === primaryId,
        prefs: prefs.get(identity.id) ?? this.prefs.prefs(identity.id),
        workspace: this.workspaces.pathFor(identity.id)
      }))
    )
  }

  async getBot(botId: string): Promise<BotDetail> {
    const bot = await this.requireBot(botId)
    const state = await this.runtimes.optionalState(bot)
    const runnable = state !== null
    return { ...this.identity(bot), instructions: bot.instructions, ...(state ?? { abilities: [], memoryConnected: false }), runnable, ...this.own(bot) }
  }

  async createBot(input: BotCreateInput): Promise<Bot> {
    try {
      const identity = await this.runtimes.create(input)
      if (input.avatar) this.prefs.setPrefs(identity.id, { avatar: input.avatar })
      await this.workspaces.ensure(identity.id)
      await this.botMemory.connectNew(identity.id)
      return { ...this.identity(identity), runnable: await this.runtimes.available(identity), ...this.own(identity) }
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
    return { ...this.identity(identity), runnable: await this.runtimes.available(identity), ...this.own(identity) }
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

  /** Without `chatId`: the bot's main conversation, created on first use and the same for every
   *  device from then on. With `chatId`: that chat, leaving the main conversation as it is. */
  async openChat(botId: string, chatId: string | undefined, onEvent: (event: ChatEvent) => void): Promise<OpenChat> {
    const bot = await this.requireBot(botId)
    await this.runtimes.state(bot)
    const workspace = await this.workspaces.ensure(botId)
    const main = this.prefs.mainChat(botId)
    const chat = await this.runtimes.engineFor(bot).openChat(bot.engineBotId, chatId ?? main, { workspace }, onEvent)
    chat.snapshot.botId = botId
    // First use, or the engine replaced a main conversation that no longer exists.
    if (!chatId && chat.snapshot.chatId !== main) this.prefs.setMainChat(botId, chat.snapshot.chatId)
    return chat
  }

  /** A new session, which becomes the bot's main conversation. The earlier one stays in the engine. */
  async newChat(botId: string, onEvent: (event: ChatEvent) => void): Promise<OpenChat> {
    const bot = await this.requireBot(botId)
    await this.runtimes.state(bot)
    const workspace = await this.workspaces.ensure(botId)
    const chat = await this.runtimes.engineFor(bot).openChat(bot.engineBotId, null, { workspace }, onEvent)
    chat.snapshot.botId = botId
    this.prefs.setMainChat(botId, chat.snapshot.chatId)
    return chat
  }

  private identity(bot: BotRecord) {
    const { id, name, function: fn, model, isDefault } = bot
    return { id, name, function: fn, model, isDefault }
  }

  private own(identity: BotRecord): Pick<Bot, 'isPrimary' | 'prefs' | 'workspace'> {
    return { isPrimary: identity.id === this.primaryId(this.runtimes.store.list()), prefs: this.prefs.prefs(identity.id), workspace: this.workspaces.pathFor(identity.id) }
  }

  private primaryId(bots: BotRecord[]): string | undefined {
    return bots.find(bot => bot.id === this.prefs.primaryBot())?.id ?? bots.find(bot => bot.isDefault)?.id
  }

  async reviewMemory(botId: string, prompt: string, options: import('../engines/bot-engine').ReviewOptions): Promise<void> {
    const bot = await this.requireBot(botId)
    try {
      await this.runtimes.state(bot)
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

  private requireBot(botId: string): Promise<BotRecord> {
    return this.runtimes.require(botId)
  }
}
