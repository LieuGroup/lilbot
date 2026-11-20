/** Shared, engine-independent exchanges. Oscar reads them and can stop one; bots supply the messages. */
import { z } from 'zod'
import type { ChatItem } from './chat-schema'

const text = z.string().trim().min(1).max(20_000)
const exchangeId = z.string().min(1).max(100)
/** Paths in the sending bot's own folder, relative to it (or absolute inside it). */
const files = z.array(z.string().min(1).max(1000)).max(10)

export const ThreadAsk = z.object({
  requestId: z.string().min(1).max(100),
  to: z.string().min(1).max(100),
  text,
  chatId: z.string().min(1).max(200),
  threadId: z.string().optional()
})
export type ThreadAsk = z.infer<typeof ThreadAsk>

/** One call hands one task to each named bot; each task is its own exchange, all of them one batch. */
export const DelegateInput = z.object({
  requestId: z.string().min(1).max(100),
  tasks: z
    .array(
      z.object({
        to: z.string().min(1).max(100).optional().describe('Bot id or exact name'),
        task: text,
        files: files.optional(),
        exchangeId: exchangeId.optional().describe('Continue this exchange')
      })
    )
    .min(1)
    .max(8)
})
export type DelegateInput = z.infer<typeof DelegateInput>
export const RedirectInput = z.object({ requestId: z.string().min(1).max(100), exchangeId, message: text })
export const AttachInput = z.object({ exchangeId, files: files.min(1) })

/** waiting: accepted, not started yet. working: the receiver is on it. The rest are final until a follow-up. */
type ExchangeStatus = 'waiting' | 'working' | 'finished' | 'failed' | 'cancelled'
export interface ExchangeFile {
  /** The sender's own file name: untrusted text, never a path. */
  name: string
  size: number
  fromId: string
  /** Where the recipient finds its copy, relative to its own folder; null while not delivered. */
  path: string | null
}
export interface ThreadMessage {
  id: string
  authorId: string
  authorName: string
  createdAt: number
  items: ChatItem[]
  /** A change of course from the delegating bot while the work was under way. */
  redirect?: true
  files?: ExchangeFile[]
  /** Arrived after the exchange was stopped: kept here, never delivered. */
  withheld?: true
}
export interface BotThread {
  id: string
  participants: { id: string; name: string }[]
  createdAt: number
  depth: number
  state: 'open' | 'limited' | 'failed'
  messages: ThreadMessage[]
  /** Tasks handed out by one call share it. */
  batchId: string | null
  /** The work item this exchange belongs to (#141); always null for now. */
  parentId: string | null
  status: ExchangeStatus
  /** What the receiver is doing right now, while it works. */
  activity: string | null
  startedAt: number | null
  endedAt: number | null
  stoppedBy: { kind: 'bot' | 'oscar'; id: string | null; name: string; at: number } | null
}
