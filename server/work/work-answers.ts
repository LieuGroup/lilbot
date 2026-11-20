/** What Oscar tells a bot from the board (his answers, and an item he dropped) on its way: saved first, then delivered as a
 *  hidden turn with a stable run id, so a retry after a transport failure or a restart reaches the same engine admission
 *  instead of a second turn. All SQL for `work_answers` is here. */
import type { Database } from 'bun:sqlite'
import { LilBotError } from '../../shared/protocol'
import { backgroundFailure } from '../background'
import type { StoredItem } from './work-store'

type Row = { id: string; item_id: string; bot_id: string; chat_id: string | null; text: string; status: 'pending' | 'stopping' }
/** Runs `prompt` as a hidden turn of the bot in `chatId`, or in its main conversation when `chatId` is null. */
export type Deliver = (botId: string, prompt: string, runId: string, chatId: string | null) => Promise<unknown>
/** Ends whatever turn the bot's session (its main conversation when null) is running. */
export type Interrupt = (botId: string, chatId: string | null) => Promise<unknown>
const RETRY_MS = 30_000

export const answerPrompt = (item: StoredItem, answer: string) =>
  `Oscar answered your question on work item ${item.id} (${JSON.stringify(item.title)}), on the work board:\n\n${answer}\n\nCarry on with the work and keep reporting on the item with lilbot_work.`
export const dropPrompt = (item: StoredItem, reason: string) =>
  `Oscar dropped your work item ${item.id} (${JSON.stringify(item.title)}) on the work board, saying ${JSON.stringify(reason)}. Stop that work now and report nothing further on it: the board refuses it. Tell Oscar in one short sentence that you stopped, then carry on with anything else you were asked.`

export class WorkAnswers {
  private running = new Set<string>()
  private retryAt = new Map<string, number>()
  constructor(
    private db: Database,
    private deliver: Deliver,
    private interrupt: Interrupt
  ) {}

  /** Work from a conversation continues in the bot's main conversation; other work in the session it came from. `stop`: the row
   *  waits as `stopping` until the turn the session is running has been ended (once), so the bot reads this and not its own last words. */
  queue(id: string, item: StoredItem, prompt: string, stop = false) {
    const chatId = item.origin.kind === 'conversation' ? null : item.chatId
    this.db
      .query('INSERT OR IGNORE INTO work_answers(id, item_id, bot_id, chat_id, text, status) VALUES (?,?,?,?,?,?)')
      .run(id, item.id, item.ownerId, chatId, prompt, stop ? 'stopping' : 'pending')
  }

  tick() {
    for (const row of this.db.query("SELECT * FROM work_answers WHERE status IN ('pending', 'stopping') ORDER BY rowid").all() as Row[]) {
      if (this.running.has(row.id) || (this.retryAt.get(row.id) ?? 0) > Date.now()) continue
      this.running.add(row.id)
      void this.send(row)
        .then(() => this.settle(row.id, 'done'))
        .catch(error => {
          if (error instanceof LilBotError && error.code === 'bot_not_found') return this.settle(row.id, 'failed')
          this.retryAt.set(row.id, Date.now() + RETRY_MS)
          backgroundFailure('work answer')
        })
        .finally(() => this.running.delete(row.id))
    }
  }

  private async send(row: Row) {
    if (row.status === 'stopping') {
      await this.interrupt(row.bot_id, row.chat_id)
      this.db.query("UPDATE work_answers SET status = 'pending' WHERE id = ?").run(row.id)
    }
    return this.deliver(row.bot_id, row.text, `work-${row.id}`, row.chat_id)
  }

  forgetBot(botId: string) {
    this.db.query("UPDATE work_answers SET status = 'dropped' WHERE bot_id = ? AND status IN ('pending', 'stopping')").run(botId)
  }

  private settle(id: string, status: 'done' | 'failed') {
    this.db.query('UPDATE work_answers SET status = ? WHERE id = ?').run(status, id)
    this.retryAt.delete(id)
  }
}
