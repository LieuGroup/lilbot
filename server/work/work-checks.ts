/** How the check of a finished level 2 or 3 item ends: the checking bot's verdict, Oscar's pass or send-back (from
 *  `work-board.ts`), or a check that could not run; and where the item goes after each. `WorkService.report` starts every
 *  check; the bot's run is `work-check-runner.ts`. */
import { LilBotError } from '../../shared/protocol'
import type { WorkCheck } from '../../shared/work-check-schema'
import { WorkInput, type WorkItem } from '../../shared/work-schema'
import { failedNotice, sentBackNotice } from './work-check-prompts'
import { afterCheck, OSCAR } from './work-check-rules'
import type { StoredCheck } from './work-check-store'
import { evidenceTexts, pointerOf, refuseUnsafe } from './work-rules'
import type { Actor, Saved, WorkService } from './work-service'
import type { ItemChange, StoredItem } from './work-store'

const LILBOT: Actor = { by: 'lilbot', via: null }

export class WorkChecks {
  constructor(
    private work: WorkService,
    private now = Date.now
  ) {}
  private get store() {
    return this.work.store
  }
  private get checks() {
    return this.work.checks
  }

  /** The verdict of the bot LilBot asked, given from the check session LilBot started, with its own evidence. */
  async verdict(callerId: string, raw: WorkInput): Promise<WorkItem> {
    const input = WorkInput.parse(raw)
    await this.work.host.requireBot(callerId)
    refuseUnsafe([input.result, ...(input.evidence ?? []).flatMap(evidenceTexts)])
    const { itemId, verdict } = input
    if (!itemId || !verdict) throw new LilBotError('work_verdict', 'Give your verdict with the itemId LilBot asked you to check.')
    const chatId = await this.work.host.callingChat(callerId, input.requestId)
    const saved = this.store.db.transaction(() => {
      const latest = this.checks.latest(itemId)
      if (latest?.verdictRequest === input.requestId && latest.by.id === callerId) return null
      const item = this.store.get(itemId)
      const check = this.checks.open(itemId)
      if (item?.status !== 'checking' || check?.by.id !== callerId)
        throw new LilBotError('work_forbidden', 'Only the bot LilBot asked to check this item gives a verdict, while its check is open.')
      if (!chatId || this.checks.checkOfChat(chatId) !== check.id)
        throw new LilBotError('work_forbidden', 'Give the verdict from the check session LilBot started, not from another conversation.')
      if (!input.result) throw new LilBotError('work_no_result', 'Say what you saw yourself (result), or why you could not check.')
      if (verdict !== 'could_not_check' && !input.evidence?.length) throw new LilBotError('work_no_evidence', 'A verdict needs evidence of what you read yourself.')
      const at = this.now()
      const entries = (input.evidence ?? []).map(e => ({ e, pointer: pointerOf(e, id => this.work.host.libraryTitle(callerId, id), at) }))
      for (const [n, { e, pointer }] of entries.entries())
        if (this.store.addEvidence(itemId, { id: `${check.id}:${n}`, proves: e.proves, pointer, byId: callerId, at }))
          this.store.log(itemId, { at, by: 'bot', kind: 'evidence', status: null, text: e.proves, via: null })
      return this.settle(item, check, verdict, input.result, { by: 'bot', via: null }, input.requestId)
    })()
    if (saved) this.work.after(saved)
    return this.work.view(itemId)
  }

  /** A bot's check ended without a verdict, or could not run. The item goes to Oscar; when it is no longer being checked
   *  (dropped meanwhile), only the check is closed. */
  ended(checkId: string, why: string) {
    const saved = this.store.db.transaction(() => {
      const check = this.checks.get(checkId)
      if (check?.state !== 'checking') return null
      const item = this.store.get(check.itemId)!
      if (item.status === 'checking') return this.settle(item, check, 'could_not_check', why, LILBOT)
      this.checks.settle(check.id, 'dropped', null, null, this.now())
      return null
    })()
    if (saved) this.work.after(saved)
  }

  /** Records how a check ended and moves the item on: done, back to its owner (told in a new turn), or to Oscar. */
  settle(item: StoredItem, check: StoredCheck, state: WorkCheck['state'], text: string | null, actor: Actor, verdictRequest: string | null = null): Saved {
    const at = this.now()
    const log = (kind: 'checked' | 'status', status: StoredItem['status'] | null, line: string | null) =>
      this.store.log(item.id, { at, by: actor.by, kind, status, text: line, via: actor.via })
    this.checks.settle(check.id, state, text, verdictRequest, at)
    log('checked', null, `${check.by.name}: ${state.replace('_', ' ')}${text ? `. ${text}` : ''}`.slice(0, 2000))
    const next = afterCheck(state, this.checks.failures(item.id), check.by.name)
    const change: ItemChange = { status: next.status, question: next.question ?? null }
    if (next.status === 'done') change.finishedAt = at
    if (next.status === 'needs_oscar') this.checks.add(item.id, OSCAR, null, null, at)
    if (next.toOwner) this.work.host.tell(`check-${check.id}`, item, state === 'sent_back' ? sentBackNotice(item, text ?? '') : failedNotice(item, check.by.name, text ?? ''))
    const number = log('status', next.status, next.question ?? null)
    this.store.update(item.id, change, at)
    return { item: this.store.get(item.id)!, asked: next.status === 'needs_oscar' ? number : null, ended: item.status === 'needs_oscar' ? number : null }
  }
}
