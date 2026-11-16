/** Shared, engine-independent exchanges. Oscar reads them; bots supply the messages. */
import { z } from 'zod'
import type { ChatItem } from './chat-schema'

export const ThreadAsk = z.object({
  requestId: z.string().min(1).max(100),
  to: z.string().min(1).max(100),
  text: z.string().trim().min(1).max(20_000),
  chatId: z.string().min(1).max(200),
  threadId: z.string().optional()
})
export type ThreadAsk = z.infer<typeof ThreadAsk>
export interface ThreadMessage {
  id: string
  authorId: string
  authorName: string
  createdAt: number
  items: ChatItem[]
}
export interface BotThread {
  id: string
  participants: { id: string; name: string }[]
  createdAt: number
  depth: number
  state: 'open' | 'limited' | 'failed'
  messages: ThreadMessage[]
}
