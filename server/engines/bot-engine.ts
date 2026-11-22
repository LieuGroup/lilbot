/** Engines run identities supplied by LilBot. Native runtime ids never become public bot ids. */
import type { ActivityEvent } from '../../shared/activity-schema'
import type { BotIdentity, BotModel, BotSetup, ModelProvider, PermissionMode, ReasoningEffort } from '../../shared/bot-schema'
import type { ChatEvent, ChatSnapshot } from '../../shared/chat-schema'
import type { MessageOrigin } from '../../shared/device-schema'
import type { ConnectionsApplied, McpConnection } from './mcp-connection'

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
export type LegacyNotes = { aboutUser: string[]; ownNotes: string[] }

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
  /** Start the run's session with only these toolsets (webhook runs, `server/webhooks/webhook-access.ts`). */
  toolsets?: string[]
  /** The model a new session runs on (a same-bot check or worker); without it, the bot's own. */
  model?: BotModel
  /** The reasoning effort a new session starts with; absent inherits on the bot's own model and omits on another model. */
  reasoningEffort?: ReasoningEffort
}

/** Partial or full context report from an engine. */
export interface ContextReport {
  used?: number
  window?: number | null
}

export interface ChatOptions {
  workspace: string
  /** Given to a session the engine creates; a resumed session keeps its own. */
  reasoningEffort?: ReasoningEffort
  /** Effective reasoning effort reported by the engine (null: none). */
  onEffort?: (effort: string | null) => void
  /** Context size and model window reported by the engine. */
  onContext?: (context: ContextReport) => void
  /** Explicit history must not silently become a new conversation. */
  omitMessages?: boolean
  requireExisting?: boolean
}

/** An edit to a stored conversation, applied from its next message. A turn that is running finishes first. */
export interface SessionChange {
  model?: BotModel
  /** A level to send, or null to go back to the engine's default; absent leaves it alone. */
  reasoningEffort?: ReasoningEffort | null
}

export type RuntimeBinding = { id: string; engineBotId: string }
/** A tool call an engine saw start in one of its chats, with the call's arguments and the engine's own id for the call. */
export interface ToolCallSeen {
  engineBotId: string
  chatId: string
  tool: string
  args: unknown
  callId?: string
}
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

/** What LilBot gives a runtime for skills. `disabled` are the library names this bot is not offered and `names` the whole library;
 *  with `includeEngineSkills` false the engine also hides the skills it offers by itself. */
export interface SkillSettings {
  root: string
  url: string
  tokenFile: string
  botId: string
  disabled: string[]
  names: string[]
  includeEngineSkills: boolean
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
  /** Only used for the one-time import of runtimes into a new database; each returned `id` is stored only as `engineBotId`. */
  importBots(): Promise<EngineBotDetail[]>
  /** Prepare a new runtime for this LilBot identity; returns its engine-native id. */
  createRuntime(identity: RuntimeIdentity): Promise<string>
  /** Apply LilBot's authoritative settings if they drifted. Missing runtimes throw bot_not_found. */
  applyIdentity(engineBotId: string, identity: RuntimeIdentity): Promise<RuntimeState>
  /** Stop this runtime and delete its conversations. Safe to repeat when already missing. */
  deleteRuntime(engineBotId: string): Promise<void>
  /** Prepare persistent policy at startup and when the saved mode changes. */
  prepareRuntime?(engineBotId: string, identity: RuntimeIdentity): Promise<void>
  /** Give this runtime exactly LilBot's MCP connections (servers named `lilbot_*` not listed are removed; others are left
   *  alone), for its sessions from their next resume. An optional one that does not connect is not an error. Safe to repeat. */
  prepareConnections?(engineBotId: string, connections: McpConnection[]): Promise<void>
  /** Bring these open conversations in step with the connections last prepared, in place: from their next message, with
   *  their context and cache kept. A running turn is never changed (`busy`: LilBot asks again once it ends). */
  applyConnections?(engineBotId: string, chatIds: string[]): Promise<{ chatId: string; state: ConnectionsApplied }[]>
  /** The name this engine reports in `onToolCall` for an MCP server's tool. */
  mcpToolName?(server: string, tool: string): string
  userSkillPaths?(engineBotId: string): string[]
  /** Skills the engine offers by itself in this runtime, without the ones in `alwaysOnSkills`: the engine's own switch can hide these. */
  bundledSkills?(engineBotId: string): string[]
  /** Engine skills nobody can hide, with the reason to show. */
  readonly alwaysOnSkills?: readonly { name: string; reason: string }[]
  configureComputers?(engineBotId: string, settings: { url: string; tokenFile: string; botId: string }): Promise<void>
  configureSkills?(engineBotId: string, settings: SkillSettings): Promise<void>
  /** Refuse an unavailable model before an identity edit is saved. Must not apply the old identity. */
  validateModel(model: BotModel): Promise<void>
  listModels(): Promise<ModelProvider[]>
  /** Switch a stored conversation's model or effort from its next message. Throws `confirm_required` if held back. */
  updateSession(engineBotId: string, chatId: string, change: SessionChange): Promise<{ effort: string | null; context?: ContextReport } | null>
  /** Open a new chat (`chatId` null) or continue a stored one. Events arrive until `close()`. */
  openChat(engineBotId: string, chatId: string | null, options: ChatOptions, onEvent: (event: ChatEvent) => void): Promise<OpenChat>
  /** Switch the bot to LilBot memory from its next session; returns legacy engine notes. */
  connectMemory(engineBotId: string, connection: MemoryConnection): Promise<LegacyNotes>
  /** Upgrade connected adapters only for LilBot's non-deleted native bindings. */
  refreshMemory(engineBotIds: string[]): Promise<string[]>
  /** Run `prompt` as a hidden memory-only session for the after-chat review. */
  reviewMemory(engineBotId: string, prompt: string, options: ReviewOptions): Promise<void>
  /** Run or recover one scheduled task, using runId as a durable execution identity. */
  runRoutine(
    engineBotId: string,
    prompt: string,
    options: RoutineOptions & ChatOptions
  ): Promise<{ status: 'completed' | 'failed' | 'stopped'; text: string; items?: import('../../shared/chat-schema').ChatItem[]; unknownReceipt?: true }>
  /** The session a compressed conversation began as, when the engine continues a long session under a new id (the chat
   *  itself when it is not such a continuation); null when it cannot tell. Engines that never do this leave it out. */
  compressionRoot?(engineBotId: string, chatId: string): string | null
  /** Told when bots or their chats changed outside this server. Returns the function that stops it. */
  onBotsChanged(listener: () => void): () => void
  /** Every tool call the engine sees start. MCP requests carry no session, so this is how LilBot's own MCP server
   *  tells which conversation called it, and what a hidden run is doing. Returns the function that stops it. */
  onToolCall?(listener: (call: ToolCallSeen) => void): () => void
  /** Stop the running turn of a chat. False when nothing was running. */
  stopRun?(engineBotId: string, chatId: string): Promise<boolean>
  /** Give a running turn more text at its next step without stopping it. */
  steerRun?(engineBotId: string, chatId: string, text: string): Promise<'steered' | 'not_running'>
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
  resumeRefused?: string // the engine's code when the asked-for conversation could not be resumed and a new one started
  send(text: string, options?: { hidden?: boolean; inputId?: string; apiText?: string; attachments?: EngineAttachment[]; origin?: TurnOrigin }): Promise<void>
  stop(): Promise<void>
  close(): void
}
