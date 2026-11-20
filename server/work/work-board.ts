/** Oscar's side of the board: the list, an item, the daily brief, dropping an item and answering a question. */
import { LilBotError } from '../../shared/protocol'
import { type WorkBrief, WorkListInput } from '../../shared/work-schema'
import type { WorkAnswers } from './work-answers'
import { refuseUnsafe } from './work-rules'
import type { WorkService } from './work-service'

const DAY_MS = 86_400_000
const OSCAR = { by: 'oscar', via: null } as const

export class WorkBoard {
  constructor(
    private work: WorkService,
    private answers: WorkAnswers,
    private now = Date.now
  ) {}

  list(raw: WorkListInput) {
    const { botId, status, from, to, limit } = WorkListInput.parse(raw)
    return this.work.store.list({ ownerId: botId, status, from, to, limit })
  }
  open(itemId: string) {
    return this.work.view(itemId)
  }

  drop(itemId: string, reason: string) {
    refuseUnsafe([reason])
    const saved = this.work.store.db.transaction(() => this.work.report(this.item(itemId), { move: { status: 'dropped', reason } }, {}, OSCAR))()
    this.work.after(saved)
    return this.work.view(itemId)
  }

  /** The answer is saved on the item and reaches the bot as a new turn: in its main conversation for work from a
   *  conversation, otherwise in the session the work came from. The item goes back to where it was before the question. */
  answer(itemId: string, answer: string) {
    refuseUnsafe([answer])
    const saved = this.work.store.db.transaction(() => {
      const item = this.item(itemId)
      if (item.status !== 'needs_oscar') throw new LilBotError('work_not_asked', 'This item is not waiting for an answer.')
      const event = this.work.store.log(item.id, { at: this.now(), by: 'oscar', kind: 'answered', status: null, text: answer, via: null })
      this.answers.queue(`answer-${event}`, item, answer)
      return this.work.report(item, {}, { status: item.startedAt === null ? 'open' : 'working' }, OSCAR)
    })()
    this.work.after(saved)
    return this.work.view(itemId)
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
