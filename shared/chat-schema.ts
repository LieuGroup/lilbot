/** Chat transcript and live events in LilBot's own terms. Engines translate into these. */
import { z } from 'zod'
import { Attachment, AttachmentMessage, ImageSupport } from './attachment-schema'
import { MessageOrigin } from './device-schema'

/** Why a turn failed, when LilBot knows: never the engine's own wording. */
const TurnFailure = z.literal('memory_save')

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
  z.object({ kind: z.literal('assistant'), text: z.string(), stopped: z.boolean().optional() }),
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
  /** `memory_save`: the turn stopped because the engine could not save the conversation to memory before shortening it
   *  (#148); the screen words it, so `text` is empty. */
  z.object({ kind: z.literal('error'), text: z.string(), reason: TurnFailure.optional() })
])
export type ChatItem = z.infer<typeof ChatItem>

export const ChatEvent = z.discriminatedUnion('type', [
  AttachmentMessage.extend({ type: z.literal('user.message') }),
  z.object({ type: z.literal('turn.started') }),
  z.object({ type: z.literal('thread'), threadId: z.string(), name: z.string(), detail: z.string(), failure: z.string().optional() }),
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
  history: z.custom<import('./history-schema').HistoryPage>().optional(),
  items: z.array(ChatItem)
})
export type ChatSnapshot = z.infer<typeof ChatSnapshot>
