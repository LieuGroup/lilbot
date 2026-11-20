/** The work board: every real piece of bot work is an item with a "done" definition, evidence and a result.
 *  Bots report on their own items; Oscar reads them all, answers questions and can drop an item. */
import { z } from 'zod'
import { KIND_NAMES, type WorkCheck, type WorkKind, type WorkLevels } from './work-check-schema'

/** open: not started. working: under way. checking: finished by its owner, a second bot is checking it (level 2).
 *  needs_oscar: waits for his answer to one question, or for his check. The last three are final. */
const WORK_STATUSES = ['open', 'working', 'checking', 'needs_oscar', 'done', 'failed', 'dropped'] as const
export type WorkStatus = (typeof WORK_STATUSES)[number]
export const FINAL_WORK: readonly WorkStatus[] = ['done', 'failed', 'dropped']

/** Who asked for the work. `self`: the bot's own initiative. Ids name the bot, routine or webhook; Oscar has none. */
export interface WorkAsker {
  kind: 'oscar' | 'bot' | 'routine' | 'webhook' | 'self'
  id: string | null
  name: string
}
/** Where the work came from: a conversation's session, an exchange between bots, a group, a routine or webhook run. */
export interface WorkOrigin {
  kind: 'conversation' | 'exchange' | 'group' | 'routine_run' | 'webhook_run'
  id: string
}

/** The real thing an evidence entry points at. */
export type EvidencePointer =
  | { kind: 'library'; itemId: string; title: string }
  | { kind: 'link'; url: string }
  | { kind: 'command'; command: string; output: string }
  | { kind: 'number'; value: string; source: string; readAt: number }
export interface Evidence {
  id: string
  /** What this entry proves, in the bot's words. */
  proves: string
  pointer: EvidencePointer
  /** The bot that added it: the owner, or a bot that checked the item. */
  byId: string
  at: number
}
/** One change to an item, kept forever. `via` is the session or run it came from, so a routine or webhook run that
 *  reports on an existing item is linked to it. */
export interface WorkEvent {
  at: number
  by: 'bot' | 'oscar' | 'lilbot'
  kind: 'opened' | 'status' | 'defined' | 'evidence' | 'answered' | 'checked'
  status: WorkStatus | null
  text: string | null
  via: WorkOrigin | null
}

export interface WorkSummary {
  id: string
  title: string
  ownerId: string
  /** The owner's name when the item was opened, kept after the bot is deleted. */
  ownerName: string
  askedBy: WorkAsker
  origin: WorkOrigin
  parentId: string | null
  /** The agreed goal this work is for (#143), given when the item is opened. */
  goalId: string | null
  /** Null on items from before kinds, and on an exchange's item until its receiver says. */
  kind: WorkKind | null
  /** 0 no check, 1 the bot checks the real result itself, 2 a second bot reproduces it, 3 Oscar checks. Never lowered. */
  checkLevel: number
  /** The kind's default level for this bot when the item got its kind: why the level is what it is. */
  defaultLevel: number | null
  /** The latest check, at levels 2 and 3. */
  check: WorkCheck | null
  status: WorkStatus
  /** The one question Oscar is asked, while the status is needs_oscar. */
  question: string | null
  evidenceCount: number
  createdAt: number
  updatedAt: number
  startedAt: number | null
  finishedAt: number | null
}
export interface WorkItem extends WorkSummary {
  /** How the bot and Oscar will know it is done, written before starting. Empty until written. */
  done: string
  result: string
  dropReason: string | null
  evidence: Evidence[]
  events: WorkEvent[]
  checks: WorkCheck[]
  children: WorkSummary[]
  /** Runs, exchanges and conversations other than its origin that reported on it. */
  links: WorkOrigin[]
}
/** The daily brief: what needs Oscar, what failed, and what was done (shown collapsed). */
export interface WorkBrief {
  since: number
  needsOscar: WorkSummary[]
  failed: WorkSummary[]
  done: { count: number; items: WorkSummary[] }
}

const text = (max: number) => z.string().trim().min(1).max(max)
const itemId = z.string().min(1).max(100)

export const EvidenceInput = z.object({
  proves: text(500),
  library: z.string().max(100).optional().describe('Library item id'),
  url: z.string().url().max(2000).optional(),
  command: text(2000).optional(),
  output: z.string().max(4000).optional(),
  value: text(200).optional().describe('A number, with source and readAt (ISO)'),
  source: text(500).optional(),
  readAt: z.string().max(40).optional()
})
export type EvidenceInput = z.infer<typeof EvidenceInput>

/** The bot's one action tool: without itemId it opens an item, with itemId it reports on one. */
export const WorkInput = z.object({
  requestId: z.string().min(1).max(100),
  itemId: itemId.optional(),
  title: text(200).optional(),
  done: text(2000).optional().describe('How you will know it is done, written before starting'),
  kind: z
    .enum(KIND_NAMES)
    .optional()
    .describe('At open. Default levels: reply, note 0; file, computer, code 1; deploy, outside (leaves the system), spending, figure (a number Oscar decides on) 2'),
  level: z
    .number()
    .int()
    .min(0)
    .max(3)
    .optional()
    .describe("At least the kind's default; raise it for anything hard to undo, never lower. 0 no check, 1 you check the real result, 2 another bot reproduces it, 3 Oscar"),
  asked: z.enum(['oscar', 'self']).optional().describe('Who asked, in a conversation (default oscar)'),
  goalId: itemId.optional().describe('At open: the agreed goal of yours this work is for'),
  status: z.enum(['working', 'needs_oscar', 'done', 'failed', 'dropped']).optional(),
  question: text(1000).optional(),
  evidence: z.array(EvidenceInput).max(10).optional(),
  result: text(4000).optional(),
  reason: text(1000).optional(),
  verdict: z
    .enum(['verified', 'not_verified', 'could_not_check'])
    .optional()
    .describe('Only when LilBot asked you to check the item: with result (what you saw, or why not) and evidence')
})
export type WorkInput = z.infer<typeof WorkInput>

export const WorkReadInput = z.object({
  itemId: itemId.optional(),
  mine: z.boolean().default(true),
  status: z.array(z.enum(WORK_STATUSES)).max(7).optional()
})

/** Oscar's board: by bot, status and time (updated between `from` and `to`), newest first. */
export const WorkListInput = z.object({
  botId: z.string().min(1).optional(),
  status: z.array(z.enum(WORK_STATUSES)).max(7).optional(),
  from: z.number().int().optional(),
  to: z.number().int().optional(),
  limit: z.number().int().min(1).max(200).default(100)
})
export type WorkListInput = z.infer<typeof WorkListInput>

/** The board's browser methods (joined into `shared/protocol.ts`); `work.changed` is pushed when any item changes. */
export const workMethods = {
  'work.list': WorkListInput,
  'work.open': z.object({ itemId }),
  /** Oscar drops an item, with his reason; nothing is deleted. */
  'work.drop': z.object({ itemId, reason: text(1000) }),
  /** Oscar answers the one question of an item that needs him; the bot gets it as a new turn. */
  'work.answer': z.object({ itemId, answer: text(4000) }),
  /** Oscar passes an item that waits for his check (level 3, or a check that failed twice or could not be done). */
  'work.pass': z.object({ itemId, note: text(1000).optional() }),
  /** Oscar sends it back to its owner with what to fix; the owner gets it as a new turn. */
  'work.sendBack': z.object({ itemId, reason: text(1000) }),
  /** The default check level of each kind: built in, Oscar's for every bot, and his per bot. */
  'work.levels.get': z.object({}),
  /** Sets Oscar's default for a kind, for every bot or one; null goes back to the default under it. */
  'work.levels.set': z.object({ kind: z.enum(KIND_NAMES), botId: z.string().min(1).optional(), level: z.number().int().min(0).max(3).nullable() }),
  /** What changed since `since` (default: the last 24 hours); what needs Oscar is always included. */
  'work.brief': z.object({ since: z.number().int().optional() })
} as const
export interface WorkResults {
  'work.list': WorkSummary[]
  'work.open': WorkItem
  'work.drop': WorkItem
  'work.answer': WorkItem
  'work.pass': WorkItem
  'work.sendBack': WorkItem
  'work.levels.get': WorkLevels
  'work.levels.set': WorkLevels
  'work.brief': WorkBrief
}
