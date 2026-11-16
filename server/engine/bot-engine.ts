/** What LeBot needs from whatever runs the bots. Hermes is the first implementation; another engine
 *  (for example one speaking ACP) only has to satisfy this interface. An engine knows a bot's
 *  identity, setup and chats. It knows nothing about the user's preferences or LeBot's database. */
import type { BotCreateInput, BotIdentity, BotSetup, BotUpdateInput, ModelProvider } from '../../shared/bot-schema'
import type { ChatEvent, ChatSnapshot } from '../../shared/chat-schema'

export type EngineBotDetail = BotIdentity & BotSetup

export interface ChatOptions {
  /** The bot's folder; the chat works there. */
  workspace: string
}

export interface BotEngine {
  listBots(): Promise<BotIdentity[]>
  getBot(botId: string): Promise<EngineBotDetail>
  createBot(input: BotCreateInput): Promise<BotIdentity>
  updateBot(input: BotUpdateInput): Promise<EngineBotDetail>
  listModels(): Promise<ModelProvider[]>
  /** Open a new chat (`chatId` null) or continue a stored one. A stored chat that no longer exists
   *  is replaced by a new one; the snapshot says which chat was opened. Events arrive until `close()`. */
  openChat(botId: string, chatId: string | null, options: ChatOptions, onEvent: (event: ChatEvent) => void): Promise<OpenChat>
  /** Told when bots or their chats changed outside this server. Returns the function that stops it. */
  onBotsChanged(listener: () => void): () => void
}

export interface OpenChat {
  snapshot: ChatSnapshot
  send(text: string): Promise<void>
  stop(): Promise<void>
  close(): void
}
