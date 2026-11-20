/** Oscar's side of the board: the list, an item, the daily brief, dropping an item and answering a question. */
import { LilBotError } from '../../shared/protocol'
import { type WorkBrief, WorkListInput } from '../../shared/work-schema'
import { backgroundFailure } from '../background'
import { answerPrompt, dropPrompt, type WorkAnswers } from './work-answers'
import { isFinal, refuseUnsafe } from './work-rules'
import type { WorkService } from './work-service'
import type { StoredItem } from './work-store'

/** What the board needs from the exchanges between bots (`server/threads/`, whose `ThreadService` has both). */
interface WorkExchanges {
  /** Oscar's answer as the receiver's next turn in the exchange, so what it says goes back to the delegating bot. Refuses when the exchange cannot take it. */
  oscarAnswer(exchangeId: string, id: string, prompt: string): void
  /** Oscar dropped the exchange's own item. Stops the exchange inside the caller's transaction; the returned function ends the receiver's turn once it is committed. */
  dropped(exchangeId: string, reason: string): () => Promise<void>
}

const DAY_MS = 86_400_000
const OSCAR = { by: 'oscar', via: null } as const

export class WorkBoard {
  constructor(
    private work: WorkService,
    private answers: WorkAnswers,
    private exchanges: WorkExchanges,
    private now = Date.now
  ) {}

  list(raw: WorkListInput) {
    const { botId, status, from, to, limit } = WorkListInput.parse(raw)
    return this.work.store.list({ ownerId: botId, status, from, to, limit })
  }
  open(itemId: string) {
    return this.work.view(itemId)
  }

  /** Drops the item and every unfinished item below it, with Oscar's reason, and stops the work. An item that is an exchange's own
   *  (work handed over) stops the exchange, which tells the delegating bot; any other owner is told in its session, after its
   *  running turn ends if it was working on the item. Both are saved with the drop, so a restart repeats nothing. */
  async drop(itemId: string, reason: string) {
    refuseUnsafe([reason])
    const { saved, ends } = this.work.store.db.transaction(() => {
      const ends: (() => Promise<void>)[] = []
      const saved = this.tree(itemId).map(item => {
        const report = this.work.report(item, { move: { status: 'dropped', reason } }, {}, OSCAR)
        if (item.origin.kind === 'exchange' && item.origin.id === item.id) ends.push(this.exchanges.dropped(item.id, reason))
        else if (item.chatId) this.answers.queue(`drop-${item.id}`, item, dropPrompt(item, reason), item.status === 'working' && item.origin.kind !== 'exchange')
        return report
      })
      return { saved, ends }
    })()
    for (const one of saved) this.work.after(one)
    await Promise.all(ends.map(end => end().catch(() => backgroundFailure('work drop'))))
    return this.work.view(itemId)
  }

  /** The item and, below it, every unfinished item. */
  private tree(itemId: string): StoredItem[] {
    const below = (id: string): StoredItem[] => this.work.store.children(id).flatMap(child => [...(isFinal(child.status) ? [] : [this.item(child.id)]), ...below(child.id)])
    return [this.item(itemId), ...below(itemId)]
  }

  /** The answer is saved on the item and reaches the bot as a new turn: in its main conversation for work from a
   *  conversation, in the exchange for work handed over by another bot (so its reply goes back to that bot), otherwise in
   *  the session the work came from. The item goes back to where it was before the question. */
  answer(itemId: string, answer: string) {
    refuseUnsafe([answer])
    const saved = this.work.store.db.transaction(() => {
      const item = this.item(itemId)
      if (item.status !== 'needs_oscar') throw new LilBotError('work_not_asked', 'This item is not waiting for an answer.')
      const event = this.work.store.log(item.id, { at: this.now(), by: 'oscar', kind: 'answered', status: null, text: answer, via: null })
      const id = `answer-${event}`
      const prompt = answerPrompt(item, answer)
      if (!this.viaExchange(item, id, prompt)) this.answers.queue(id, item, prompt)
      return this.work.report(item, {}, { status: item.startedAt === null ? 'open' : 'working' }, OSCAR)
    })()
    this.work.after(saved)
    return this.work.view(itemId)
  }

  /** False when the exchange cannot take another message (full, failed): the receiver then still gets the answer in its own session. */
  private viaExchange(item: StoredItem, id: string, prompt: string) {
    if (item.origin.kind !== 'exchange') return false
    try {
      this.exchanges.oscarAnswer(item.origin.id, id, prompt)
      return true
    } catch (error) {
      if (error instanceof LilBotError) return false
      throw error
    }
  }

  /** What needs Oscar (all of it), and what failed or was done since `since` (the last day by default). */
  brief(since = this.now() - DAY_MS): WorkBrief {
    const list = (status: 'needs_oscar' | 'failed' | 'done', from?: number) => this.work.store.list({ status: [status], from, limit: 200 })
    const done = list('done', since)
    return { since, needsOscar: list('needs_oscar'), failed: list('failed', since), done: { count: done.length, items: done } }
  }

  private item(itemId: string) {
    const item = this.work.store.get(itemId)
    if (!item) throw new LilBotError('work_missing', 'No work item has that id.')
    return item
  }
}
