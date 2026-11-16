/** Chat transcript and live events in LeBot's own terms. Engines translate into these. */
import { z } from 'zod'

export const ChatItem = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), text: z.string() }),
  z.object({ kind: z.literal('assistant'), text: z.string(), stopped: z.boolean().optional() }),
  z.object({ kind: z.literal('tool'), toolId: z.string(), name: z.string(), detail: z.string(), running: z.boolean(), failed: z.boolean().optional() }),
  z.object({ kind: z.literal('error'), text: z.string() })
])
export type ChatItem = z.infer<typeof ChatItem>

export const ChatEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('turn.started') }),
  /** Short status while the bot thinks, e.g. "pondering...". */
  z.object({ type: z.literal('activity'), text: z.string() }),
  z.object({ type: z.literal('text.delta'), text: z.string() }),
  z.object({ type: z.literal('tool.started'), toolId: z.string(), name: z.string(), detail: z.string() }),
  z.object({ type: z.literal('tool.finished'), toolId: z.string(), failed: z.boolean() }),
  z.object({ type: z.literal('turn.finished'), status: z.enum(['completed', 'stopped', 'failed']), text: z.string() }),
  z.object({ type: z.literal('title'), title: z.string() }),
  z.object({ type: z.literal('error'), message: z.string() }),
  /** The engine lost this chat's connection; open the chat again to continue. */
  z.object({ type: z.literal('closed'), message: z.string() })
])
export type ChatEvent = z.infer<typeof ChatEvent>

export const ChatSnapshot = z.object({ chatId: z.string(), botId: z.string(), title: z.string(), running: z.boolean(), items: z.array(ChatItem) })
export type ChatSnapshot = z.infer<typeof ChatSnapshot>
