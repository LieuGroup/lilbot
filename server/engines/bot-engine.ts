/** What LilBot needs from whatever runs the bots. Hermes is the first implementation; another engine
 *  (for example one speaking ACP) only has to satisfy this interface. An engine knows a bot's
 *  identity, setup and chats. It knows nothing about the user's preferences or LilBot's database. */

import type { ActivityEvent } from '../../shared/activity-schema'
import type { BotCreateInput, BotIdentity, BotModel, BotSetup, BotUpdateInput, ModelProvider } from '../../shared/bot-schema'
import type { ChatEvent, ChatSnapshot } from '../../shared/chat-schema'

export type EngineBotDetail = BotIdentity & BotSetup

/** Where an engine adapter on this machine reaches LilBot's memory. */
export interface MemoryConnection {
  url: string
  tokenFile: string
}

/** Notes an engine kept in its own memory before the bot was connected to LilBot's. */
export interface LegacyNotes {
  aboutUser: string[]
  ownNotes: string[]
}

export interface ReviewOptions {
  /** The model to run the review on; without it, the bot's own. */
  model?: BotModel
  /** Called with every id the engine knows the review session by, before the review starts. */
  onChat: (chatId: string) => void
}

export interface ChatOptions {
  /** The bot's folder; the chat works there. */
  workspace: string
}

export interface BotEngine {
  watchActivity?(listener: (event: ActivityEvent) => void, cursor: (botId: string, chatId: string) => string | undefined): () => void
  listBots(): Promise<BotIdentity[]>
  getBot(botId: string): Promise<EngineBotDetail>
  createBot(input: BotCreateInput): Promise<BotIdentity>
  updateBot(input: BotUpdateInput): Promise<EngineBotDetail>
  listModels(): Promise<ModelProvider[]>
  /** Open a new chat (`chatId` null) or continue a stored one. A stored chat that no longer exists
   *  is replaced by a new one; the snapshot says which chat was opened. Events arrive until `close()`. */
  openChat(botId: string, chatId: string | null, options: ChatOptions, onEvent: (event: ChatEvent) => void): Promise<OpenChat>
  /** Makes the bot read and write LilBot's memory instead of the engine's own, from its next
   *  session on. Returns the notes the engine had, so LilBot can keep them. */
  connectMemory(botId: string, connection: MemoryConnection): Promise<LegacyNotes>
  /** Brings every connected bot's memory adapter up to this LilBot's version. Returns the bots it
   *  updated. Called at start-up, so shipping a new adapter needs no manual step. */
  refreshMemory(): Promise<string[]>
  /** Runs `prompt` as a hidden session of the bot with only its memory tools, and resolves when
   *  the bot has finished. Used by the after-chat memory review. */
  reviewMemory(botId: string, prompt: string, options: ReviewOptions): Promise<void>
  /** Told when bots or their chats changed outside this server. Returns the function that stops it. */
  onBotsChanged(listener: () => void): () => void
}

export interface OpenChat {
  snapshot: ChatSnapshot
  send(text: string): Promise<void>
  stop(): Promise<void>
  close(): void
}
