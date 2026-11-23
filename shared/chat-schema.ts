/** Chat transcript and live events in LilBot's own terms. Engines translate into these. */
import { z } from 'zod'
import { Attachment, AttachmentMessage, ImageSupport } from './attachment-schema'
import { BotContext } from './bot-schema'
import { ConnectionSignInCard } from './connections-schema'
import { MessageOrigin } from './device-schema'

/** Why a turn failed, when LilBot knows: never the engine's own wording. */
const TurnFailure = z.literal('memory_save')

/** Token and cache counts for one turn, when the engine reports them. Counts only: no prices. */
export const TurnUsage = z.object({
  /** Fresh (non-cached) input tokens sent during this turn. */
  inputTokens: z.number().int().nonnegative().optional(),
  /** Tokens read from prompt cache during this turn. */
  cacheReadTokens: z.number().int().nonnegative().optional(),
  /** Tokens written to prompt cache during this turn. */
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  /** Output tokens produced during this turn. */
  outputTokens: z.number().int().nonnegative().optional(),
  /** Conversation context size in tokens at the end of this turn. */
  contextTokens: z.number().int().nonnegative().optional(),
  /** Model context window in tokens reported with this turn. */
  contextWindow: z.number().int().positive().optional()
})
export type TurnUsage = z.infer<typeof TurnUsage>

/** Context size before and after a compaction observed during a turn. */
export const CompactionSizes = z.object({
  beforeTokens: z.number().int().nonnegative().optional(),
  afterTokens: z.number().int().nonnegative().optional()
})
export type CompactionSizes = z.infer<typeof CompactionSizes>

export const ChatItem = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('user'),
    text: z.string(),
    messageId: z.string().optional(),
    attachments: z.array(Attachment).optional(),
    images: ImageSupport.optional(),
    /** The device it was sent from; messages sent before devices existed have none. */
    origin: MessageOrigin.optional()
  }),
  z.object({ kind: z.literal('assistant'), text: z.string(), stopped: z.boolean().optional(), usage: TurnUsage.optional() }),
  z.object({
    kind: z.literal('tool'),
    toolId: z.string(),
    name: z.string(),
    detail: z.string(),
    threadId: z.string().optional(),
    /** The work item this line links to, in the conversation it was opened from. */
    workItemId: z.string().optional(),
    result: z.string().optional(),
    running: z.boolean(),
    failed: z.boolean().optional()
  }),
  /** Where the engine shortened the conversation (a compaction handoff). */
  z.object({
    kind: z.literal('compaction'),
    /** How many messages the engine summarized, when reported. */
    compactedMessages: z.number().int().nonnegative().optional(),
    /** Context size in tokens before shortening, when known. */
    beforeTokens: z.number().int().nonnegative().optional(),
    /** Context size in tokens after shortening, when known. */
    afterTokens: z.number().int().nonnegative().optional(),
    /** Reader-facing summary written by the engine, when present. */
    summary: z.string().optional()
  }),
  /** `memory_save`: the turn stopped because the engine could not save the conversation to memory before shortening it
   *  (#148); the screen words it, so `text` is empty. */
  z.object({ kind: z.literal('error'), text: z.string(), reason: TurnFailure.optional() }),
  /** An in-chat sign-in card for an MCP service a bot added (#216). Never holds the sign-in URL, state or pasted address. */
  z.object({ kind: z.literal('connection.sign_in'), card: ConnectionSignInCard })
])
export type ChatItem = z.infer<typeof ChatItem>

export const ChatEvent = z.discriminatedUnion('type', [
  AttachmentMessage.extend({ type: z.literal('user.message') }),
  z.object({ type: z.literal('turn.started') }),
  z.object({ type: z.literal('thread'), threadId: z.string(), name: z.string(), detail: z.string(), failure: z.string().optional() }),
  /** Live creation or state change of an in-chat service sign-in card (#216). Never carries the sign-in URL or state. */
  z.object({ type: z.literal('connection.sign_in'), card: ConnectionSignInCard }),
  /** Short status while the bot thinks, e.g. "pondering...". */
  z.object({ type: z.literal('activity'), text: z.string() }),
  z.object({ type: z.literal('text.delta'), text: z.string() }),
  z.object({ type: z.literal('tool.started'), toolId: z.string(), name: z.string(), detail: z.string() }),
  z.object({ type: z.literal('tool.finished'), toolId: z.string(), failed: z.boolean() }),
  z.object({
    type: z.literal('turn.finished'),
    status: z.enum(['completed', 'stopped', 'failed']),
    text: z.string(),
    /** How many tokens the model was sent on the turn's last call, when the engine reports it. */
    contextTokens: z.number().optional(),
    /** Per-turn token and cache counts, when the engine reports them. */
    usage: TurnUsage.optional(),
    /** Engine-stable history row id for this turn's final assistant message, when reported. */
    rowId: z.string().optional(),
    /** Context sizes before and after a compaction observed during this turn. */
    compacted: CompactionSizes.optional(),
    /** Set when LilBot knows why a failed turn failed; its `text` is then empty. */
    failure: TurnFailure.optional()
  }),
  z.object({ type: z.literal('title'), title: z.string() }),
  z.object({ type: z.literal('error'), message: z.string() }),
  /** The engine lost this chat's connection; open the chat again to continue. */
  z.object({ type: z.literal('closed'), message: z.string() })
])
export type ChatEvent = z.infer<typeof ChatEvent>

export const ChatSnapshot = z.object({
  chatId: z.string(),
  botId: z.string(),
  title: z.string(),
  running: z.boolean(),
  /** The folder this chat works in, as the engine reports it. */
  workspace: z.string(),
  /** Current context size of this conversation against its model's window, when reported. */
  context: BotContext.optional(),
  history: z.custom<import('./history-schema').HistoryPage>().optional(),
  /** Set on a finished routine or webhook run whose transcript was no longer available to save. */
  transcriptNotKept: z.boolean().optional(),
  items: z.array(ChatItem)
})
export type ChatSnapshot = z.infer<typeof ChatSnapshot>
