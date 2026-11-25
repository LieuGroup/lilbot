/** Durable tracking for persistent pre-compress memory-save refusals (Option B + Option C binary splitting).
 *  Counts dual-model refusals per `(botId, chatId, pieceKey)` using SHA-256 keys and approximate non-text timing
 *  only — never storing conversation text — and surfaces an explicit owner choice only after the narrowed piece
 *  is refused twice in an eligible owner conversation. Nothing is skipped without Oscar's explicit `skip_piece` choice. */
import type { Database } from 'bun:sqlite'
import { LilBotError } from '../../shared/lilbot-error'
import type { CheckpointChoice, MemoryCheckpointRefusal } from '../../shared/memory-schema'
import type { RefusalContext } from './memory-checkpoint'
import { findStoppedTurn, pieceTiming, type StoppedTurn } from './memory-checkpoint-meta'
import type { CheckpointStore } from './memory-checkpoint-store'

const REFUSALS_BEFORE_CHOICE = 2

export interface CheckpointChoiceAudit {
  at: number
  botId: string
  pieceKey: string
  choice: CheckpointChoice
  chosenBy: 'oscar'
}

type RefusalRow = {
  bot_id: string
  chat_id: string
  piece_key: string
  piece_keys: string
  refusal_count: number
  state: 'counting' | 'waiting' | 'resolved'
  single_message: number
  piece_at: number | null
  messages_back: number | null
  two_models: number
  choice: CheckpointChoice | null
  chosen_by: string | null
  first_refused_at: number
  last_refused_at: number
  chosen_at: number | null
}

const toPublic = (row: RefusalRow): MemoryCheckpointRefusal => ({
  botId: row.bot_id,
  chatId: row.chat_id,
  pieceKey: row.piece_key,
  refusalCount: row.refusal_count,
  singleMessage: row.single_message === 1,
  pieceAt: row.piece_at,
  messagesBack: row.messages_back,
  usedTwoModels: row.two_models === 1,
  firstRefusedAt: row.first_refused_at,
  lastRefusedAt: row.last_refused_at
})

export class MemoryCheckpointRefusalStore {
  constructor(
    private db: Database,
    private checkpointStore: CheckpointStore,
    private onChanged: () => void = () => {},
    private onChoiceRecorded?: (audit: CheckpointChoiceAudit) => void,
    private now: () => number = Date.now
  ) {}

  /** Records one dual-model refusal of a narrowed pass. Moves to `waiting` only at >= 2 refusals on an eligible owner chat. */
  recordRefusal(
    botId: string,
    chatId: string,
    pieceKey: string,
    pieceKeys: readonly string[],
    eligibleForChoice: boolean,
    context?: RefusalContext
  ): { refusalCount: number; waiting: boolean } {
    const at = this.now()
    const timing = context
      ? pieceTiming(this.db, botId, chatId, context.pieces, context.totalMessages, context.lastRole)
      : { singleMessage: pieceKeys.length <= 1, pieceAt: null, messagesBack: null }
    const twoModels = context?.usedTwoModels ? 1 : 0
    const single = timing.singleMessage ? 1 : 0
    let notify = false
    const result = this.db
      .transaction(() => {
        const existing = this.db
          .query<RefusalRow, [string, string, string]>('SELECT * FROM memory_checkpoint_refusals WHERE bot_id = ? AND chat_id = ? AND piece_key = ?')
          .get(botId, chatId, pieceKey)
        if (!existing) {
          const initialState: 'counting' | 'waiting' = eligibleForChoice && 1 >= REFUSALS_BEFORE_CHOICE ? 'waiting' : 'counting'
          this.db
            .query(
              `INSERT INTO memory_checkpoint_refusals
                (bot_id, chat_id, piece_key, piece_keys, refusal_count, state, single_message, piece_at, messages_back, two_models, first_refused_at, last_refused_at)
               VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(botId, chatId, pieceKey, JSON.stringify(pieceKeys), initialState, single, timing.pieceAt, timing.messagesBack, twoModels, at, at)
          if (initialState === 'waiting') notify = true
          return { refusalCount: 1, waiting: initialState === 'waiting' }
        }
        if (existing.state === 'resolved') return { refusalCount: existing.refusal_count, waiting: false }
        const count = existing.refusal_count + 1
        const nextState: 'counting' | 'waiting' = eligibleForChoice && count >= REFUSALS_BEFORE_CHOICE ? 'waiting' : 'counting'
        const pieceAt = timing.pieceAt ?? existing.piece_at
        const messagesBack = timing.messagesBack ?? existing.messages_back
        this.db
          .query(
            `UPDATE memory_checkpoint_refusals
             SET piece_keys = ?, refusal_count = ?, state = ?, single_message = ?, piece_at = ?, messages_back = ?, two_models = ?, last_refused_at = ?
             WHERE bot_id = ? AND chat_id = ? AND piece_key = ?`
          )
          .run(JSON.stringify(pieceKeys), count, nextState, single, pieceAt, messagesBack, twoModels || existing.two_models, at, botId, chatId, pieceKey)
        if (nextState === 'waiting') notify = true
        return { refusalCount: count, waiting: nextState === 'waiting' }
      })
      .immediate()
    if (notify) this.onChanged()
    return result
  }

  /** Clears non-resolved refusal state if a subsequent retry succeeds cleanly. */
  clearPending(botId: string, chatId: string, pieceKey: string) {
    const existing = this.db
      .query<{ state: string }, [string, string, string]>('SELECT state FROM memory_checkpoint_refusals WHERE bot_id = ? AND chat_id = ? AND piece_key = ?')
      .get(botId, chatId, pieceKey)
    if (!existing || existing.state === 'resolved') return
    this.db.query("DELETE FROM memory_checkpoint_refusals WHERE bot_id = ? AND chat_id = ? AND piece_key = ? AND state <> 'resolved'").run(botId, chatId, pieceKey)
    if (existing.state === 'waiting') this.onChanged()
  }

  /** The active waiting refusal card for `(botId, chatId)`, if any. */
  pending(botId: string, chatId: string): MemoryCheckpointRefusal | null {
    const row = this.db
      .query<RefusalRow, [string, string]>("SELECT * FROM memory_checkpoint_refusals WHERE bot_id = ? AND chat_id = ? AND state = 'waiting' ORDER BY last_refused_at DESC LIMIT 1")
      .get(botId, chatId)
    return row ? toPublic(row) : null
  }

  /** Whether any waiting card exists for `botId` (used when starting a new session via the toolbar to refresh other devices). */
  hasWaiting(botId: string): boolean {
    return Boolean(this.db.query<{ n: number }, [string]>("SELECT 1 AS n FROM memory_checkpoint_refusals WHERE bot_id = ? AND state = 'waiting' LIMIT 1").get(botId))
  }

  /** Inspects the tail of `(botId, chatId)` for a clean stopped user turn that can be resumed after `skip_piece`. */
  stoppedTurn(botId: string, chatId: string): StoppedTurn {
    return findStoppedTurn(this.db, botId, chatId)
  }

  /** Records Oscar's explicit choice atomically. Only `skip_piece` marks that one piece's keys reviewed. */
  choose(botId: string, chatId: string, pieceKey: string, choice: CheckpointChoice): { ok: true; choice: CheckpointChoice } {
    const at = this.now()
    this.db
      .transaction(() => {
        const row = this.db
          .query<RefusalRow, [string, string, string]>("SELECT * FROM memory_checkpoint_refusals WHERE bot_id = ? AND chat_id = ? AND piece_key = ? AND state = 'waiting'")
          .get(botId, chatId, pieceKey)
        if (!row) throw new LilBotError('checkpoint_choice_not_found', 'There is no waiting memory save choice for this conversation.')
        this.db
          .query("UPDATE memory_checkpoint_refusals SET state = 'resolved', choice = ?, chosen_by = 'oscar', chosen_at = ? WHERE bot_id = ? AND chat_id = ? AND piece_key = ?")
          .run(choice, at, botId, chatId, pieceKey)
        if (choice === 'skip_piece') {
          const keys = JSON.parse(row.piece_keys) as string[]
          this.checkpointStore.record(botId, keys, at)
        }
        this.onChoiceRecorded?.({ at, botId, pieceKey, choice, chosenBy: 'oscar' })
      })
      .immediate()
    this.onChanged()
    return { ok: true, choice }
  }

  /** Deletes active refusal rows when a bot is deleted (audit history remains in `system_changes`). */
  forgetBot(botId: string) {
    this.db.query('DELETE FROM memory_checkpoint_refusals WHERE bot_id = ?').run(botId)
  }
}
