// Check levels on work items (#142). Oscar's browser methods for them are in `workMethods`.
import type { BotModel } from './bot-schema'

/** The kinds of work, each with its built-in check level. Oscar can change the default per kind, and per kind for one bot.
 *  outside: a message or post that leaves the system. figure: a number Oscar will decide on. */
export const WORK_KINDS = { reply: 0, note: 0, file: 1, computer: 1, code: 1, deploy: 2, outside: 2, spending: 2, figure: 2 } as const
export type WorkKind = keyof typeof WORK_KINDS
export const KIND_NAMES = Object.keys(WORK_KINDS) as [WorkKind, ...WorkKind[]]

/** One check of a finished level 2 or 3 item: by the second bot LilBot chose, by a fresh session of the owner itself when
 *  no other bot could (`sameBot`), or by Oscar. `checking` while the bot's check runs or the item waits for his. A level 2
 *  or 3 item is done only as `verified` (a bot) or `passed` (Oscar). */
export interface WorkCheck {
  round: number
  by: { kind: 'bot'; id: string; name: string } | { kind: 'oscar'; id: null; name: 'the owner' }
  state: 'checking' | 'verified' | 'not_verified' | 'could_not_check' | 'passed' | 'sent_back' | 'dropped'
  /** What the checker saw, why it could not check, or Oscar's word. */
  text: string | null
  /** LilBot's own note, such as the model a same-bot check ran on. */
  note: string | null
  /** No other bot was eligible, so a new hidden session of the owner (`by`), told nothing but the claim, checked read-only. */
  sameBot: boolean
  /** The model a same-bot check runs on, when one that differs from the owner's is configured; null: the owner's own. */
  model: BotModel | null
  at: number
  settledAt: number | null
}

/** Per kind: the built-in level, the level for every bot (Oscar's when he set one) and his per-bot levels by bot id. */
export interface WorkLevels {
  kinds: { kind: WorkKind; builtIn: number; level: number; bots: Record<string, number> }[]
}
