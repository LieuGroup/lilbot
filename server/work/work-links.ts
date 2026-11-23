/** How other work hangs on the board: work handed to another bot inside an item becomes that bot's child item, a
 *  stopped exchange drops it, and a deleted bot's unfinished items are dropped. Nothing is ever removed. */
import { LilBotError } from '../../shared/lilbot-error'
import type { WorkKind } from '../../shared/work-check-schema'
import type { WorkOrigin } from '../../shared/work-schema'
import { fromWebhook, sameOrigin, webhookLevel } from './webhook-items'
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
    const session = this.work.host.session(callerId, chatId).origin
    const narrowed = this.work.host.isNarrowedOrigin
    if (itemId) {
      const item = this.store.get(itemId)
      if (item?.ownerId !== callerId) throw new LilBotError('work_forbidden', 'Hand work over under one of your own items.')
      if (fromWebhook(session, narrowed) && !(fromWebhook(item.origin, narrowed) && sameOrigin(item.origin, session)))
        throw new LilBotError('work_webhook_other', 'A webhook run hands work over only under an item this run opened.')
      if (isFinal(item.status)) throw new LilBotError('work_final', `That item is ${item.status}. Open a new item for new work.`)
      return itemId
    }
    const ids = new Set(this.store.unfinishedIn(callerId, chatId))
    const own = this.store.prepared(callerId, session)
    if (own && !isFinal(own.status)) ids.add(own.id)
    return ids.size === 1 ? [...ids][0] : null
  }

  /** The receiver's own item for an exchange handed out under `parentId`, with the exchange's id. Its receiver writes
   *  the "done" definition. Runs inside the exchange's own transaction; a repeat adds nothing. */
  child(parentId: string, exchange: { id: string; owner: Bot; asker: Bot; task: string }) {
    this.prepare(parentId, exchange, { kind: 'exchange', id: exchange.id })
    this.work.host.changed()
  }

  /** A `code` work item LilBot opens for every same-bot worker exchange (under `parentId` when one exists, else
   *  top-level), at the bot's effective default check level for `code`. Runs inside the exchange's own transaction. */
  workerChild(parentId: string | null, exchange: { id: string; owner: Bot; task: string }) {
    const origin: WorkOrigin = { kind: 'exchange', id: exchange.id }
    const raw = this.work.levels.floor('code', exchange.owner.id)
    const floor = fromWebhook(origin, this.work.host.isNarrowedOrigin) ? webhookLevel(raw) : raw
    this.prepare(parentId, { ...exchange, asker: exchange.owner }, origin, { kind: 'code', floor, self: true })
    this.work.host.changed()
  }

  /** Each member's own item for its part in a group started under `parentId`, asked by the leader; the member writes
   *  the "done" definition. Runs inside the group's own transaction. */
  groupChildren(parentId: string, items: { id: string; owner: Bot; asker: Bot; task: string; groupId: string }[]) {
    for (const item of items) this.prepare(parentId, item, { kind: 'group', id: item.groupId })
    this.work.host.changed()
  }

  /** Members' unfinished items for a group that has ended are dropped, saying how it ended. */
  groupEnded(groupId: string, reason: string) {
    for (const item of this.store.unfinished({ originKind: 'group' })) if (item.origin.id === groupId) this.dropAs(item.id, reason)
  }

  /** An item LilBot opens for work another bot or a worker asked for; a repeat adds nothing. */
  private prepare(
    parentId: string | null,
    work: { id: string; owner: Bot; asker: Bot; task: string },
    origin: WorkOrigin,
    preset?: { kind: WorkKind; floor: number; self?: boolean }
  ) {
    const at = this.now()
    const created = this.store.create({
      id: work.id,
      ownerId: work.owner.id,
      ownerName: work.owner.name,
      requestId: null,
      title: titleOf(work.task),
      done: '',
      kind: preset?.kind ?? null,
      checkLevel: preset?.floor ?? 1,
      defaultLevel: preset?.floor ?? null,
      status: 'open',
      askedBy: { kind: preset?.self ? 'self' : 'bot', id: work.asker.id, name: work.asker.name },
      origin,
      chatId: null,
      parentId,
      goalId: null,
      at
    })
    if (created) this.store.log(work.id, { at, by: 'lilbot', kind: 'opened', status: 'open', text: work.task.slice(0, 2000), via: null })
  }

  /** Items from exchanges that were stopped are dropped, saying who stopped them. */
  settleExchanges(stoppedBy: (exchangeId: string) => string | null) {
    for (const item of this.store.unfinished({ originKind: 'exchange' })) {
      const who = stoppedBy(item.origin.id)
      if (who) this.dropAs(item.id, `The exchange was stopped by ${who}.`)
    }
  }

  /** A deleted bot's unfinished items are dropped, its answers still on their way are not sent and Oscar's levels for it
   *  are removed. A check it was doing ends when its run finds the bot gone. */
  forgetBot(botId: string) {
    for (const item of this.store.unfinished({ ownerId: botId })) this.dropAs(item.id, 'The bot was deleted.')
    this.answers.forgetBot(botId)
    this.work.levels.forgetBot(botId)
  }

  private dropAs(itemId: string, reason: string) {
    const saved = this.store.db.transaction(() => this.work.report(this.store.get(itemId)!, { move: { status: 'dropped', reason } }, {}, LILBOT))()
    this.work.after(saved)
  }
}
