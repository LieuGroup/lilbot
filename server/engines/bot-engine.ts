/** Engines run identities supplied by LilBot. Native runtime ids never become public bot ids. */
import type { ActivityEvent } from '../../shared/activity-schema'
import type { BotIdentity, BotModel, BotSetup, ModelProvider, PermissionMode } from '../../shared/bot-schema'
import type { ChatEvent, ChatSnapshot } from '../../shared/chat-schema'
import type { MessageOrigin } from '../../shared/device-schema'

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

/** Where a turn came from, given by LilBot beside the user's text and never part of it. `line` is what the model is told
 *  for this turn only; `device` is what LilBot stores with a user message (a routine run or another bot has none). */
export interface TurnOrigin {
  line: string
  device?: MessageOrigin
}

export interface ReviewOptions {
  /** The model to run the review on; without it, the bot's own. */
  model?: BotModel
  /** Called with every id the engine knows the review session by, before the review starts. */
  onChat: (chatId: string) => void
}

export interface RoutineOptions {
  runId: string
  /** Continue the initiating context when an asynchronous answer arrives. */
  chatId?: string
  hiddenInput?: boolean
  baseline?: (length: number) => number
  onChat: (chatId: string) => void
  origin?: TurnOrigin
}

export interface ChatOptions {
  /** The bot's folder; the chat works there. */
  workspace: string
  /** Explicit history must not silently become a new conversation. */
  omitMessages?: boolean
  requireExisting?: boolean
}

/** An MCP server LilBot supplies to every bot, the same for every engine (today: T3 Code through
 *  LilBot's bridge, `server/connections/`). The bearer token is a LilBot credential for this bot only. */
export interface McpConnection {
  name: string
  url: string
  bearerToken: string
  /** Seconds one tool call may take. */
  timeoutSeconds: number
  /** The tools the engine should offer; the bridge enforces the same list. */
  tools: readonly string[]
}

export type RuntimeBinding = { id: string; engineBotId: string }
export type ActivityCursor = (botId: string, chatId: string) => string | undefined

export interface ConversationSource {
  list(): Promise<{ id: string; at: number }[]>
  read(
    id: string,
    cursor?: string | null,
    latest?: boolean
  ): Promise<{ rows: { id: string; at: number; order: number; item: import('../../shared/chat-schema').ChatItem }[]; cursor: string | null; reset: boolean; empty: boolean }>
  close(): void
}

export interface BotEngine {
  conversations?(nativeId: string): Promise<ConversationSource>
  /** Observe existing bound runtimes; emit and persist cursors using the LilBot id. */
  watchActivity?(
    bots: () => Promise<RuntimeBinding[]>,
    listener: (event: ActivityEvent) => void,
    cursor: ActivityCursor,
    availability?: (nativeId: string, available: boolean) => void,
    conversationEvent?: (botId: string, chatId: string, event: ChatEvent, key: string) => void
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
  /** Make LilBot's MCP connections available to this runtime from its next session. Safe to repeat. */
  prepareConnections?(engineBotId: string, connections: McpConnection[]): Promise<void>
  userSkillPaths?(id: string): string[]
  configureComputers?(id: string, settings: { url: string; tokenFile: string; botId: string }): Promise<void>
  configureSkills?(id: string, settings: { root: string; url: string; tokenFile: string; botId: string; disabled: string[]; names: string[] }): Promise<void>
  /** Refuse an unavailable model before an identity edit is saved. Must not apply the old identity. */
  validateModel(model: BotModel): Promise<void>
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
  runRoutine(
    botId: string,
    prompt: string,
    options: RoutineOptions & ChatOptions
  ): Promise<{ status: 'completed' | 'failed' | 'stopped'; text: string; items?: import('../../shared/chat-schema').ChatItem[] }>
  /** Told when bots or their chats changed outside this server. Returns the function that stops it. */
  onBotsChanged(listener: () => void): () => void
}

export interface EngineAttachment {
  id: string
  name: string
  mime: string
  path: string
  data: Uint8Array
}

export interface OpenChat {
  imageSupport?: 'supported' | 'unsupported' | 'unknown'
  snapshot: ChatSnapshot
  send(text: string, options?: { hidden?: boolean; inputId?: string; apiText?: string; attachments?: EngineAttachment[]; origin?: TurnOrigin }): Promise<void>
  stop(): Promise<void>
  close(): void
}
