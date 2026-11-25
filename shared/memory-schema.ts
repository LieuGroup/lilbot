/** Memory in LilBot's own terms. A fact is one short statement a bot (or the user) saved. */
import { z } from 'zod'
import { DeviceId } from './device-schema'

/** `profile`: lasting facts, about the user or about how to do the work. `journal`: dated history. */
export const MemoryKind = z.enum(['profile', 'journal'])
export type MemoryKind = z.infer<typeof MemoryKind>

/** `bot`: only the bot that learned it sees it. `shared`: every bot of the user sees it. */
export const MemoryScope = z.enum(['bot', 'shared'])
export type MemoryScope = z.infer<typeof MemoryScope>

export const MemoryFact = z.object({
  id: z.string(),
  /** The bot that learned it (for a fact the user typed: the bot whose page it was typed on). */
  botId: z.string(),
  kind: MemoryKind,
  scope: MemoryScope,
  text: z.string(),
  /** Who wrote it down. */
  author: z.enum(['bot', 'user']),
  /** How it got here: said in a chat, found by the after-chat review, typed in the app, or
   *  brought over from the engine's own notes. */
  via: z.enum(['chat', 'review', 'app', 'import']),
  learnedAt: z.number(),
  /** Switched off: kept, but not shown to bots. */
  paused: z.boolean(),
  /** After this moment the fact is no longer shown to bots. */
  expiresAt: z.number().nullable(),
  forgottenAt: z.number().nullable(),
  /** Who removed it: the user in the app, or a bot. */
  forgottenBy: z.enum(['bot', 'user']).nullable()
})
export type MemoryFact = z.infer<typeof MemoryFact>

export const factText = z.string().trim().min(1, 'Write the fact to remember.').max(500, 'Keep a fact under 500 characters.')

/** Without a scope, facts about the user are shared and a bot's history stays with the bot. */
export const defaultScope = (kind: MemoryKind): MemoryScope => (kind === 'profile' ? 'shared' : 'bot')

export const MemoryWriteInput = z.object({ botId: z.string().min(1), kind: MemoryKind, scope: MemoryScope.optional(), text: factText })
export type MemoryWriteInput = z.infer<typeof MemoryWriteInput>

/** The app-wide Memory page reads one list at a time: every kept fact, the shared ones, one bot's own, or the removed ones.
 *  `query` narrows by words; pages run newest first (removed: most recently removed first). */
export const MemoryBrowseInput = z
  .object({
    view: z.enum(['kept', 'shared', 'bot', 'removed']),
    botId: z.string().min(1).optional(),
    query: z.string().trim().max(200).optional(),
    cursor: z.string().max(64).optional(),
    limit: z.number().int().min(1).max(200).default(50)
  })
  .refine(input => input.view !== 'bot' || !!input.botId, 'Name the bot whose facts to list.')
export type MemoryBrowseInput = z.output<typeof MemoryBrowseInput>

/** A bot named on the Memory page: `facts` counts the kept facts only it knows; a deleted bot keeps its name. */
export interface MemoryBot {
  botId: string
  name: string
  deleted: boolean
  facts: number
}

export interface MemoryBrowsePage {
  facts: MemoryFact[]
  nextCursor: string | null
  /** Kept facts every bot sees, and facts removed from memory. */
  shared: number
  removed: number
  /** Every bot that knows facts of its own, or learned a fact on this page. */
  bots: MemoryBot[]
  /** Live bots still on their engine's own notes, which can be connected to LilBot's memory. */
  notConnected: { botId: string; name: string }[]
}

export const CheckpointChoice = z.enum(['skip_piece', 'new_session'])
export type CheckpointChoice = z.infer<typeof CheckpointChoice>

/** Waiting pre-compress memory-save refusal card shown to Oscar in an eligible owner conversation after both the
 *  review model and the bot's own model refused the same narrowed part twice. Never carries conversation text. */
export const MemoryCheckpointRefusal = z.object({
  botId: z.string(),
  chatId: z.string(),
  pieceKey: z.string(),
  refusalCount: z.number().int().min(2),
  /** True when binary splitting narrowed the refused part to one single message. */
  singleMessage: z.boolean(),
  /** Approximate epoch ms of the refused part from LilBot's stored history, or null when unavailable. */
  pieceAt: z.number().nullable(),
  /** Roughly how many messages back from the end of the conversation the refused part sits, or null when unknown. */
  messagesBack: z.number().int().min(1).nullable(),
  /** Whether LilBot tried two different models (review model + bot's own model). */
  usedTwoModels: z.boolean(),
  firstRefusedAt: z.number(),
  lastRefusedAt: z.number()
})
export type MemoryCheckpointRefusal = z.infer<typeof MemoryCheckpointRefusal>

const botId = z.string().min(1)
const chatId = z.string().min(1)
const factId = z.string().min(1)
/** The browser's memory methods; `protocol.ts` spreads them into `methods`. */
export const memoryMethods = {
  /** Everything the bot can see in memory, and whether the bot is connected to it. */
  'memory.list': z.object({ botId }),
  /** Settings > Memory: all of memory across bots, a page at a time. Read-only; only the owner's browser can call it. */
  'memory.listAll': MemoryBrowseInput,
  /** The user adds a fact from the app. */
  'memory.write': MemoryWriteInput,
  'memory.forget': z.object({ factId }),
  /** Brings a forgotten fact back. */
  'memory.restore': z.object({ factId }),
  /** Switches a fact off (kept, not shown to bots) or back on. */
  'memory.pause': z.object({ factId, paused: z.boolean() }),
  /** Connects a bot to LilBot's memory and brings over the notes its engine kept. */
  'memory.connect': z.object({ botId }),
  'memory.checkpointPending': z.object({ botId, chatId: chatId.optional() }),
  'memory.checkpointChoose': z.object({ botId, chatId, pieceKey: z.string().min(1).max(128), choice: CheckpointChoice, deviceId: DeviceId.optional() })
}

export interface MemoryResults {
  'memory.list': { connected: boolean; botName?: string; facts: MemoryFact[]; forgotten: MemoryFact[] }
  'memory.listAll': MemoryBrowsePage
  'memory.write': MemoryFact
  'memory.forget': { ok: true }
  'memory.restore': { ok: true }
  'memory.pause': { ok: true }
  'memory.connect': { imported: number }
  'memory.checkpointPending': MemoryCheckpointRefusal | null
  'memory.checkpointChoose': { ok: true; choice: CheckpointChoice; resumed: boolean; needsResend?: boolean }
}
