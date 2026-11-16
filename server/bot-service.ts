/** What LeBot does with bots, whichever screen or client asks. It joins the three owners of a bot:
 *  the engine (identity, setup, chats), the user's preferences (database) and the bot's workspace
 *  folder. Transport (`client-session.ts`) sits above it; the engine and the stores sit below. */
import type { Bot, BotCreateInput, BotDetail, BotIdentity, BotPrefsInput, BotUpdateInput, ModelProvider, Section } from '../shared/bot-schema'
import type { ChatEvent } from '../shared/chat-schema'
import type { MemoryFact, MemoryWriteInput } from '../shared/memory-schema'
import { LeBotError } from '../shared/protocol'
import type { PrefsStore } from './db/prefs-store'
import type { BotEngine, MemoryConnection, OpenChat } from './engine/bot-engine'
import type { MemoryService } from './memory/memory-service'
import type { Workspaces } from './workspaces'

export interface BotServiceOptions {
  /** Called whenever the bot list would look different to a client. */
  changed?: () => void
  /** Called whenever a fact was saved or forgotten through the app. */
  memoryChanged?: () => void
  /** Where engine adapters reach LeBot's memory. Without it, bots are not connected to memory. */
  memoryConnection?: MemoryConnection
}

/** An engine's own notes can be longer than a LeBot fact; the start is kept. */
const NOTE_LIMIT = 500

export class BotService {
  private changed: () => void
  private memoryChanged: () => void
  private memoryConnection?: MemoryConnection

  constructor(
    private engine: BotEngine,
    private prefs: PrefsStore,
    private workspaces: Workspaces,
    private memory: MemoryService,
    options: BotServiceOptions = {}
  ) {
    this.changed = options.changed ?? (() => {})
    this.memoryChanged = options.memoryChanged ?? (() => {})
    this.memoryConnection = options.memoryConnection
  }

  async listBots(): Promise<Bot[]> {
    const identities = await this.engine.listBots()
    const prefs = this.prefs.prefsFor(identities.map(bot => bot.id))
    return identities.map(identity => ({ ...identity, prefs: prefs.get(identity.id) ?? this.prefs.prefs(identity.id), workspace: this.workspaces.pathFor(identity.id) }))
  }

  async getBot(botId: string): Promise<BotDetail> {
    const detail = await this.engine.getBot(botId)
    return { ...detail, ...this.own(detail) }
  }

  async createBot(input: BotCreateInput): Promise<Bot> {
    const identity = await this.engine.createBot(input)
    if (input.avatar) this.prefs.setPrefs(identity.id, { avatar: input.avatar })
    await this.workspaces.ensure(identity.id)
    // A new bot uses LeBot's memory from its first session. The engine may have started it as a
    // copy of another bot, so only what is known about the user is kept: another bot's working
    // notes are not this bot's.
    if (this.memoryConnection) await this.connectMemory(identity.id, { keepOwnNotes: false })
    this.changed()
    return { ...identity, ...this.own(identity) }
  }

  async updateBot(input: BotUpdateInput): Promise<BotDetail> {
    const detail = await this.engine.updateBot(input)
    this.changed()
    return { ...detail, ...this.own(detail) }
  }

  async setPrefs({ botId, ...patch }: BotPrefsInput): Promise<Bot> {
    const identity = await this.requireBot(botId)
    this.prefs.setPrefs(botId, patch)
    this.changed()
    return { ...identity, ...this.own(identity) }
  }

  async listMemory(botId: string): Promise<{ connected: boolean; facts: MemoryFact[] }> {
    const detail = await this.engine.getBot(botId)
    return { connected: detail.memoryConnected, facts: this.memory.list(botId) }
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

  /** Connects a bot to LeBot's memory and keeps the notes its engine had: what it knew about the
   *  user becomes shared facts, its own notes stay private to it. Safe to call again. */
  async connectMemory(botId: string, options: { keepOwnNotes: boolean } = { keepOwnNotes: true }): Promise<{ imported: number }> {
    if (!this.memoryConnection) throw new LeBotError('memory_unavailable', 'Memory is not set up on this LeBot server.')
    const notes = await this.engine.connectMemory(botId, this.memoryConnection)
    const before = this.memory.list(botId).length
    for (const text of notes.aboutUser) this.memory.write({ botId, kind: 'profile', scope: 'shared', text: text.slice(0, NOTE_LIMIT), author: 'bot' })
    for (const text of options.keepOwnNotes ? notes.ownNotes : []) this.memory.write({ botId, kind: 'profile', scope: 'bot', text: text.slice(0, NOTE_LIMIT), author: 'bot' })
    this.memoryChanged()
    return { imported: this.memory.list(botId).length - before }
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
    const workspace = await this.workspaces.ensure(botId)
    const main = this.prefs.mainChat(botId)
    const chat = await this.engine.openChat(botId, chatId ?? main, { workspace }, onEvent)
    // First use, or the engine replaced a main conversation that no longer exists.
    if (!chatId && chat.snapshot.chatId !== main) this.prefs.setMainChat(botId, chat.snapshot.chatId)
    return chat
  }

  /** A new session, which becomes the bot's main conversation. The earlier one stays in the engine. */
  async newChat(botId: string, onEvent: (event: ChatEvent) => void): Promise<OpenChat> {
    const workspace = await this.workspaces.ensure(botId)
    const chat = await this.engine.openChat(botId, null, { workspace }, onEvent)
    this.prefs.setMainChat(botId, chat.snapshot.chatId)
    return chat
  }

  /** The parts of a bot that LeBot, not the engine, holds. */
  private own(identity: BotIdentity): Pick<Bot, 'prefs' | 'workspace'> {
    return { prefs: this.prefs.prefs(identity.id), workspace: this.workspaces.pathFor(identity.id) }
  }

  private async requireBot(botId: string): Promise<BotIdentity> {
    const identity = (await this.engine.listBots()).find(bot => bot.id === botId)
    if (!identity) throw new LeBotError('bot_not_found', 'That bot does not exist.')
    return identity
  }
}
