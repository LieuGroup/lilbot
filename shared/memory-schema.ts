/** Memory in LilBot's own terms. A fact is one short statement a bot (or the user) saved. */
import { z } from 'zod'

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
  forgottenAt: z.number().nullable()
})
export type MemoryFact = z.infer<typeof MemoryFact>

export const factText = z.string().trim().min(1, 'Write the fact to remember.').max(500, 'Keep a fact under 500 characters.')

/** Without a scope, facts about the user are shared and a bot's history stays with the bot. */
export const defaultScope = (kind: MemoryKind): MemoryScope => (kind === 'profile' ? 'shared' : 'bot')

export const MemoryWriteInput = z.object({ botId: z.string().min(1), kind: MemoryKind, scope: MemoryScope.optional(), text: factText })
export type MemoryWriteInput = z.infer<typeof MemoryWriteInput>
