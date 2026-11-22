/** A bot waiting on several exchanges is told once, when the last one has settled: folded into that one's answer when
 *  it brings one to the same conversation (no extra turn), otherwise as a short notice. All SQL for `thread_waits`. */
import { createHash } from 'node:crypto'
import type { BotThread } from '../../shared/thread-schema'
import { noticePrompt } from './thread-prompts'
import { FINAL, type ThreadStore } from './thread-store'

type Wait = { id: string; bot_id: string; chat_id: string; thread_ids: string; delivery_id: string | null; done: number }

export class ThreadWaits {
  constructor(private store: ThreadStore) {}

  /** The same set of exchanges waited on twice is one wait. */
  add(botId: string, chatId: string, threadIds: string[]) {
    const id = createHash('sha256')
      .update(`${botId}\n${[...threadIds].sort().join('\n')}`)
      .digest('hex')
      .slice(0, 32)
    this.store.db.query('INSERT OR IGNORE INTO thread_waits(id,bot_id,chat_id,thread_ids) VALUES(?,?,?,?)').run(id, botId, chatId, JSON.stringify(threadIds))
    return id
  }

  /** Called in the transaction that settles `threadId`; `answer` is the delivery that settlement queued, if any. */
  settle(threadId: string, answer: { id: string; target: string; sourceChat: string } | null) {
    const open = this.store.db.query('SELECT * FROM thread_waits WHERE done=0 AND thread_ids LIKE ?').all(`%${JSON.stringify(threadId)}%`) as Wait[]
    for (const wait of open) {
      const threads = (JSON.parse(wait.thread_ids) as string[]).map(id => this.store.get(id))
      if (!threads.every(t => (FINAL as readonly string[]).includes(t.status))) continue
      if (answer && answer.target === wait.bot_id && answer.sourceChat === wait.chat_id) {
        this.store.db.query('UPDATE thread_waits SET done=1, delivery_id=? WHERE id=?').run(answer.id, wait.id)
        continue
      }
      this.store.db.query('UPDATE thread_waits SET done=1 WHERE id=?').run(wait.id)
      const text = `all ${threads.length} tasks you were waiting for are in: ${summary(threads, wait.bot_id)}. Answers that came back have reached you already.`
      this.store.enqueue(`wait:${wait.id}`, threadId, wait.bot_id, wait.bot_id, wait.chat_id, noticePrompt(text), 'notice')
    }
  }

  /** The "all in" line folded into an answer, if one was. */
  foldedInto(deliveryId: string): string | null {
    const wait = this.store.db.query('SELECT * FROM thread_waits WHERE delivery_id=?').get(deliveryId) as Wait | null
    return wait
      ? summary(
          (JSON.parse(wait.thread_ids) as string[]).map(id => this.store.get(id)),
          wait.bot_id
        )
      : null
  }
}

function summary(threads: BotThread[], botId: string) {
  return threads.map(t => `${t.worker ? 'worker' : (t.participants.find(p => p.id !== botId)?.name ?? 'a bot')} ${t.status} (exchange ${t.id})`).join('; ')
}
