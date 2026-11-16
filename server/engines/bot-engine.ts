/** Engines run identities supplied by LilBot. Native runtime ids never become public bot ids. */
import type { ActivityEvent } from '../../shared/activity-schema'
import type { BotIdentity, BotModel, BotSetup, ModelProvider, PermissionMode } from '../../shared/bot-schema'
import type { ChatEvent, ChatSnapshot } from '../../shared/chat-schema'

export type EngineBotDetail = BotIdentity & BotSetup
export type RuntimeIdentity = BotIdentity & { instructions: string }
export type RuntimeState = Pick<BotSetup, 'abilities' | 'memoryConnected'>

/** Where an engine adapter on this machine reaches LilBot's memory. */
export interface MemoryConnection {
  url: string
  tokenFile: string
  /** Stable LilBot id, independent of the engine profile id. */
  botId?: string
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

export interface MessageOptions {
  messageId: string
  chatId?: string
  onChat: (chatId: string) => void
}

export interface RoutineOptions {
  runId: string
  onChat: (chatId: string) => void
}

export interface ChatOptions {
  /** The bot's folder; the chat works there. */
  workspace: string
  /** Explicit history must not silently become a new conversation. */
  requireExisting?: boolean
}

export type RuntimeBinding = { id: string; engineBotId: string }
export type ActivityCursor = (botId: string, chatId: string) => string | undefined

export interface BotEngine {
  /** Observe existing bound runtimes; emit and persist cursors using the LilBot id. */
  watchActivity?(
    bots: () => Promise<RuntimeBinding[]>,
    listener: (event: ActivityEvent) => void,
    cursor: ActivityCursor,
    availability?: (nativeId: string, available: boolean) => void
  ): () => void
  readonly supportedPermissionModes: readonly PermissionMode[]
  readonly id: string
  /** Only used for the one-time migration of identities that predate LilBot ownership. */
  importBots(): Promise<EngineBotDetail[]>
  /** Prepare a new runtime for this LilBot identity; returns its engine-native id. */
  createRuntime(identity: RuntimeIdentity): Promise<string>
  /** Apply LilBot's authoritative settings if they drifted. Missing runtimes throw bot_not_found. */
  applyIdentity(engineBotId: string, identity: RuntimeIdentity): Promise<RuntimeState>
  /** Stop this runtime and delete its conversations. Safe to repeat when already missing. */
  deleteRuntime(engineBotId: string): Promise<void>
  /** Prepare persistent policy at startup and when the saved mode changes. */
  prepareRuntime?(engineBotId: string, identity: RuntimeIdentity): Promise<void>
  listModels(): Promise<ModelProvider[]>
  /** Open a new chat (`chatId` null) or continue a stored one. A stored chat that no longer exists
   *  is replaced by a new one; the snapshot says which chat was opened. Events arrive until `close()`. */
  openChat(botId: string, chatId: string | null, options: ChatOptions, onEvent: (event: ChatEvent) => void): Promise<OpenChat>
  /** Makes the bot read and write LilBot's memory instead of the engine's own, from its next
   *  session on. Returns the notes the engine had, so LilBot can keep them. */
  connectMemory(botId: string, connection: MemoryConnection): Promise<LegacyNotes>
  /** Upgrades connected adapters only for LilBot's non-deleted bindings (native ids). Returns
   *  updated native ids. Start-up passes must never discover their own set of profiles. */
  refreshMemory(botIds: string[]): Promise<string[]>
  /** Runs `prompt` as a hidden session of the bot with only its memory tools, and resolves when
   *  the bot has finished. Used by the after-chat memory review. */
  reviewMemory(botId: string, prompt: string, options: ReviewOptions): Promise<void>
  /** Run or recover one scheduled task, using runId as a durable execution identity. */
  runRoutine(botId: string, prompt: string, options: RoutineOptions & ChatOptions): Promise<{ status: 'completed' | 'failed' | 'stopped'; text: string }>
  /** A clearly attributed app message in an existing conversation, recovered by messageId. */
  deliverMessage(botId: string, chatId: string, text: string, messageId: string): Promise<{ status: 'completed' | 'failed' | 'stopped'; text: string }>
  /** Told when bots or their chats changed outside this server. Returns the function that stops it. */
  onBotsChanged(listener: () => void): () => void
}

export interface OpenChat {
  snapshot: ChatSnapshot
  send(text: string, options?: { hidden?: boolean; inputId?: string }): Promise<void>
  stop(): Promise<void>
  close(): void
}
