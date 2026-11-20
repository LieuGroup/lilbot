/** How other work hangs on the board: work handed to another bot inside an item becomes that bot's child item, a
 *  stopped exchange drops it, and a deleted bot's unfinished items are dropped. Nothing is ever removed. */
import { LilBotError } from '../../shared/protocol'
import type { WorkAnswers } from './work-answers'
import { isFinal, titleOf } from './work-rules'
import type { WorkService } from './work-service'

type Bot = { id: string; name: string }
const LILBOT = { by: 'lilbot', via: null } as const

export class WorkLinks {
  constructor(
    private work: WorkService,
    private answers: WorkAnswers,
    private now = Date.now
  ) {}
  private get store() {
    return this.work.store
  }

  /** The caller's item a delegation from `chatId` belongs to: the one it names, else its only unfinished item in that
   *  session (an exchange's own item counts in the exchange's session). Null when there is none or several. */
  parentFor(callerId: string, chatId: string, itemId?: string): string | null {
    if (itemId) {
      const item = this.store.get(itemId)
      if (item?.ownerId !== callerId) throw new LilBotError('work_forbidden', 'Hand work over under one of your own items.')
      if (isFinal(item.status)) throw new LilBotError('work_final', `That item is ${item.status}. Open a new item for new work.`)
      return itemId
    }
    const ids = new Set(this.store.unfinishedIn(callerId, chatId))
    const session = this.work.host.session(callerId, chatId).origin
    const own = session.kind === 'exchange' ? this.store.get(session.id) : null
    if (own?.ownerId === callerId && !isFinal(own.status)) ids.add(own.id)
    return ids.size === 1 ? [...ids][0] : null
  }

  /** The receiver's own item for an exchange handed out under `parentId`, with the exchange's id. Its receiver writes
   *  the "done" definition. Runs inside the exchange's own transaction; a repeat adds nothing. */
  child(parentId: string, exchange: { id: string; owner: Bot; asker: Bot; task: string }) {
    const at = this.now()
    const created = this.store.create({
      id: exchange.id,
      ownerId: exchange.owner.id,
      ownerName: exchange.owner.name,
      requestId: null,
      title: titleOf(exchange.task),
      done: '',
      checkLevel: 1,
      status: 'open',
      askedBy: { kind: 'bot', id: exchange.asker.id, name: exchange.asker.name },
      origin: { kind: 'exchange', id: exchange.id },
      chatId: null,
      parentId,
      at
    })
    if (created) this.store.log(exchange.id, { at, by: 'lilbot', kind: 'opened', status: 'open', text: exchange.task.slice(0, 2000), via: null })
    this.work.host.changed()
  }

  /** Items from exchanges that were stopped are dropped, saying who stopped them. */
  settleExchanges(stoppedBy: (exchangeId: string) => string | null) {
    for (const item of this.store.unfinished({ originKind: 'exchange' })) {
      const who = stoppedBy(item.origin.id)
      if (who) this.dropAs(item.id, `The exchange was stopped by ${who}.`)
    }
  }

  /** A deleted bot's unfinished items are dropped and its answers still on their way are not sent. */
  forgetBot(botId: string) {
    for (const item of this.store.unfinished({ ownerId: botId })) this.dropAs(item.id, 'The bot was deleted.')
    this.answers.forgetBot(botId)
  }

  private dropAs(itemId: string, reason: string) {
    const saved = this.store.db.transaction(() => this.work.report(this.store.get(itemId)!, { move: { status: 'dropped', reason } }, {}, LILBOT))()
    this.work.after(saved)
  }
}
