/** Shared, engine-independent exchanges. Oscar reads them and can stop one; bots supply the messages. */
import { z } from 'zod'
import { BotModel, ReasoningEffort } from './bot-schema'
import type { ChatItem } from './chat-schema'
import type { WebhookCapability } from './webhook-schema'

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

const delegateTask = z
  .object({
    to: z.string().min(1).max(100).optional().describe('Bot id or exact name'),
    worker: z.literal(true).optional().describe('Start a fresh hidden worker session of yourself'),
    model: BotModel.optional().describe('Worker only: model for this worker session'),
    reasoningEffort: ReasoningEffort.optional().describe('Worker only: starting reasoning effort'),
    computer: z.string().trim().min(1).max(100).optional().describe('Worker only: computer id or exact name to run on'),
    cwd: z.string().min(1).max(4096).optional().describe('Remote worker only: absolute or ~/ folder path on that computer'),
    task: text,
    files: files.optional(),
    exchangeId: exchangeId.optional().describe('Continue this exchange')
  })
  .superRefine((t, ctx) => {
    if (t.worker && t.to) ctx.addIssue({ code: 'custom', message: 'Give either worker: true or to, not both.', path: ['worker'] })
    if (t.to && t.exchangeId) ctx.addIssue({ code: 'custom', message: 'Give either to or exchangeId, not both.', path: ['to'] })
    if ((t.model || t.reasoningEffort) && (!t.worker || t.exchangeId))
      ctx.addIssue({ code: 'custom', message: 'model and reasoningEffort apply only when starting a new worker.', path: ['model'] })
    if ((t.computer || t.cwd) && (!t.worker || t.exchangeId))
      ctx.addIssue({ code: 'custom', message: 'computer and cwd apply only when starting a new worker.', path: ['computer'] })
    if (t.cwd && !t.computer) ctx.addIssue({ code: 'custom', message: 'Give a computer when specifying cwd.', path: ['cwd'] })
    if (t.computer && t.computer !== 'leader' && !t.cwd) ctx.addIssue({ code: 'custom', message: 'Give a folder (cwd) when starting a worker on another computer.', path: ['cwd'] })
  })

/** One call hands tasks to other bots or starts same-bot workers; each task is its own exchange, all of them one batch. */
export const DelegateInput = z.object({
  requestId: z.string().min(1).max(100),
  itemId: z.string().min(1).max(100).optional().describe('Your work item this is part of'),
  tasks: z.array(delegateTask).min(1).max(8)
})
export type DelegateInput = z.infer<typeof DelegateInput>
export const RedirectInput = z.object({ requestId: z.string().min(1).max(100), exchangeId, message: text })
export const AttachInput = z.object({ exchangeId, files: files.min(1) })
/** Control over handed-out exchanges, plus attaching answer files as the receiver. */
export const DelegationActionInput = z.object({
  action: z.enum(['status', 'cancel', 'redirect', 'wait', 'attach']),
  exchangeId: exchangeId.optional(),
  exchangeIds: z.array(exchangeId).max(20).optional(),
  batchId: z.string().max(100).optional(),
  requestId: z.string().min(1).max(100).optional(),
  message: text.optional(),
  files: files.optional()
})
export type DelegationActionInput = z.infer<typeof DelegationActionInput>

const names = z.array(z.string().min(1).max(100))
/** The one tool of a temporary group (`server/threads/group-service.ts`). The leader starts, says the next point and closes;
 *  a member attaches files to its reply; anyone in the group reads its status. */
export const GroupInput = z.object({
  action: z.enum(['start', 'say', 'attach', 'close', 'status']),
  requestId: z.string().min(1).max(100).optional().describe('Needed to start, say and close; reuse only when retrying'),
  groupId: z.string().min(1).max(100).optional(),
  purpose: z.string().trim().min(1).max(300).optional(),
  members: names.min(2).max(4).optional().describe('Other bots: ids or exact names'),
  text: text.optional().describe('start and say: the point. close: the outcome'),
  to: names.min(1).max(4).optional().describe('Members the point is for; everyone when left out'),
  files: files.optional(),
  keep: files.optional().describe('close: files from the group folder worth keeping; they go to your folder and Library'),
  itemId: z.string().min(1).max(100).optional().describe('Your work item this is part of')
})
export type GroupInput = z.infer<typeof GroupInput>

/** waiting: accepted, not started yet. working: the receiver is on it. The rest are final until a follow-up. */
type ExchangeStatus = 'waiting' | 'working' | 'finished' | 'failed' | 'cancelled'
export interface ExchangeFile {
  /** The sender's own file name: untrusted text, never a path. */
  name: string
  size: number
  fromId: string
  /** Where the recipient finds its copy, relative to its own folder (in a group: to the group's folder); null while not delivered. */
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
  /** Oscar's answer to the receiver's question on its work item, passed on by LilBot; the author is the delegating bot. */
  oscar?: true
  files?: ExchangeFile[]
  /** Arrived after the exchange was stopped: kept here, never delivered. */
  withheld?: true
  /** Reply from a same-bot worker (both participants carry the same bot id). */
  fromWorker?: true
  /** In a group: the leader's point that opens this round. */
  round?: number
}
/** The message id under which the files a group's leader kept are recorded and downloaded. */
export const keptId = (groupId: string) => `${groupId}:kept`
/** How a group ended: closed by its leader, stopped by Oscar, or by itself (round, message or time limit, gone quiet,
 *  its leader unreachable). */
export type GroupEnd = 'closed' | 'stopped' | 'rounds' | 'messages' | 'time' | 'quiet' | 'failed'
/** One member's place in the group now: addressed and waiting, at work, replied to the current round, or not addressed. */
export interface GroupMember {
  id: string
  state: 'waiting' | 'working' | 'replied' | 'idle'
  activity: string | null
}
/** A temporary group: the thread's first participant leads, the rest are members. */
export interface ThreadGroup {
  purpose: string
  /** Rounds the group may run before it ends by itself (the round limit). */
  roundCap: number
  /** Each round: the members its point is for and, in a view, who has replied. */
  rounds: { n: number; to: string[]; at: number; requestId: string; replied?: string[] }[]
  /** Bot turns spent in the group so far. */
  turns: number
  /** Last movement (a point, a reply); going quiet counts from here. */
  lastAt: number
  end: { how: GroupEnd; at: number; outcome: string } | null
  /** Files the leader kept on close: copied into its own folder (path relative to it) and its Library. */
  kept: ExchangeFile[]
  /** The temporary shared folder: files passed in the group are copied here. */
  folder: string
  /** How many messages each bot has been shown, so each prompt carries only what is new to it. */
  seen: Record<string, number>
  /** In a view: every participant, the leader first. */
  members?: GroupMember[]
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
  /** The delegating bot's work item this exchange was handed out under; the receiver's own item has the exchange's id. */
  parentId: string | null
  status: ExchangeStatus
  /** Why it failed, in LilBot's own fixed words (never raw error text); only while `status` is failed. Older failures have none. */
  failure?: string
  /** What the receiver is doing right now, while it works. */
  activity: string | null
  startedAt: number | null
  endedAt: number | null
  /** In a view, while it runs: a redirect waits for the receiver's next step (it did not reach the running turn). */
  redirecting?: true
  stoppedBy: { kind: 'bot' | 'oscar'; id: string | null; name: string; at: number } | null
  /** Present when the exchange is a same-bot worker session rather than work between two bots. */
  worker?: true
  /** Model override a worker started with, when different from the bot's own. */
  model?: BotModel
  /** Starting reasoning effort override for a worker. */
  reasoningEffort?: ReasoningEffort
  /** Computer id this worker runs on, when not the leader. */
  computer?: string
  /** Display name of that computer (stored at start time, refreshed live in views). */
  computerName?: string
  /** Working folder on that computer. */
  cwd?: string
  /** Capability grant carried from a narrowed calling run; absent means unrestricted. */
  capabilities?: WebhookCapability[]
  /** Present when the thread is a temporary group rather than an exchange between two bots. */
  group?: ThreadGroup
}
