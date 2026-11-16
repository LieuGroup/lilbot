/** What LeBot does with bots, whichever screen or client asks. It joins the three owners of a bot:
 *  the engine (identity, setup, chats), the user's preferences (database) and the bot's workspace
 *  folder. Transport (`client-session.ts`) sits above it; the engine and the stores sit below. */
import type { Bot, BotCreateInput, BotDetail, BotIdentity, BotPrefsInput, BotUpdateInput, ModelProvider, Section } from '../shared/bot-schema'
import type { ChatEvent } from '../shared/chat-schema'
import { LeBotError } from '../shared/protocol'
import type { PrefsStore } from './db/prefs-store'
import type { BotEngine, OpenChat } from './engine/bot-engine'
import type { Workspaces } from './workspaces'

export class BotService {
  /** `changed` is called whenever the bot list would look different to a client. */
  constructor(
    private engine: BotEngine,
    private prefs: PrefsStore,
    private workspaces: Workspaces,
    private changed: () => void = () => {}
  ) {}

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
