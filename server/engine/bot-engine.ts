/** What LeBot needs from whatever runs the bots. Hermes is the first implementation; another engine
 *  (for example one speaking ACP) only has to satisfy this interface. */
import type { Bot, BotCreateInput, BotDetail, BotUpdateInput, ModelProvider } from '../../shared/bot-schema'
import type { ChatEvent, ChatSnapshot } from '../../shared/chat-schema'

export interface BotEngine {
  listBots(): Promise<Bot[]>
  getBot(botId: string): Promise<BotDetail>
  createBot(input: BotCreateInput): Promise<Bot>
  updateBot(input: BotUpdateInput): Promise<BotDetail>
  listModels(): Promise<ModelProvider[]>
  /** Open a new chat (`chatId` null) or continue a stored one. Events arrive until `close()`. */
  openChat(botId: string, chatId: string | null, onEvent: (event: ChatEvent) => void): Promise<OpenChat>
}

export interface OpenChat {
  snapshot: ChatSnapshot
  send(text: string): Promise<void>
  stop(): Promise<void>
  close(): void
}
