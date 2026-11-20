/** What a bot does on the board, through LilBot's MCP server: open an item and report on its own items. The caller is
 *  always the authenticated bot; where the call came from is worked out from LilBot's own records, never an argument. */
import { LilBotError } from '../../shared/protocol'
import { type WorkAsker, WorkInput, type WorkItem, type WorkOrigin, WorkReadInput } from '../../shared/work-schema'
import { chooseChecker, NO_CHECKER, OSCAR, reviewQuestion, underItem } from './work-check-rules'
import { WorkCheckStore } from './work-check-store'
import { WorkChecks } from './work-checks'
import { WorkLevelStore } from './work-levels'
import { belowDefault, evidenceTexts, isFinal, levelChange, type Move, noKind, pointerOf, refuseUnsafe, transition } from './work-rules'
import type { ItemChange, StoredItem, WorkStore } from './work-store'

/** The session a call came from. `askedBy` is null in a conversation, where the bot says who asked. */
export interface SessionOrigin {
  origin: WorkOrigin
  askedBy: WorkAsker | null
}
type Bot = { id: string; name: string }
export interface WorkHost {
  requireBot(id: string): Promise<Bot>
  /** The bots that could check an item now (any bot not deleted whose runtime is ready or being prepared). */
  checkers(): Promise<Bot[]>
  /** The bot's session that made this call (matched by its request id), or null. */
  callingChat(botId: string, requestId: string): Promise<string | null>
  session(botId: string, chatId: string): SessionOrigin
  /** The title of the bot's own Library item, or null. */
  libraryTitle(botId: string, itemId: string): string | null
  /** While an item needs Oscar its bot shows as waiting and turns unread (unless he is viewing); `on` false ends it. */
  waiting(botId: string, itemId: string, key: string, on: boolean): void
  /** The line in a conversation that links to an item opened there. */
  line(item: StoredItem): void
  /** A notice for the item's owner, delivered once as a new turn where its work continues (`id` keeps it once). */
  tell(id: string, item: StoredItem, prompt: string): void
  changed(): void
}
export type Actor = { by: 'bot' | 'oscar' | 'lilbot'; via: WorkOrigin | null }
/** One report: a new definition, evidence and a move to another status, applied in that order. */
export type Report = Pick<Partial<WorkInput>, 'done' | 'evidence' | 'requestId'> & { move?: Move; checkers?: Bot[] }
export type Saved = { item: StoredItem; asked: number | null; ended: number | null }

export class WorkService {
  readonly checks: WorkCheckStore
  readonly levels: WorkLevelStore
  /** How checks end: the checking bot's verdict, Oscar's, or a check that could not run. */
  readonly checking: WorkChecks
  constructor(
    readonly store: WorkStore,
    readonly host: WorkHost,
    private now = Date.now
  ) {
    this.checks = new WorkCheckStore(store.db)
    this.levels = new WorkLevelStore(store.db)
    this.checking = new WorkChecks(this, now)
  }

  view(id: string): WorkItem {
    const item = this.store.get(id)
    if (!item) throw new LilBotError('work_missing', 'No work item has that id.')
    const events = this.store.events(id)
    const seen = new Set([JSON.stringify(item.origin)])
    const links = events.flatMap(e => (e.via && !seen.has(JSON.stringify(e.via)) && seen.add(JSON.stringify(e.via)) ? [e.via] : []))
    const { chatId, ...rest } = item
    return { ...rest, evidence: this.store.evidence(id), events, children: this.store.children(id), links, checks: this.checks.all(id) }
  }

  async read(callerId: string, raw: unknown) {
    const input = WorkReadInput.parse(raw)
    await this.host.requireBot(callerId)
    if (input.itemId) return this.view(input.itemId)
    return { items: this.store.list({ ownerId: input.mine ? callerId : undefined, status: input.status, limit: 50 }) }
  }

  /** Opens an item (no itemId) or reports on one of the caller's own items, all in one call; a check's verdict too. */
  async act(callerId: string, raw: WorkInput): Promise<WorkItem> {
    const input = WorkInput.parse(raw)
    if (input.verdict) return this.checking.verdict(callerId, input)
    const caller = await this.host.requireBot(callerId)
    refuseUnsafe([input.title, input.done, input.question, input.result, input.reason, ...(input.evidence ?? []).flatMap(evidenceTexts)])
    const chatId = await this.host.callingChat(callerId, input.requestId)
    if (!input.itemId && chatId && this.checks.isCheckChat(chatId))
      throw new LilBotError('work_check_session', 'This session is a check: give your verdict, do not open items here.')
    const session = chatId ? this.host.session(callerId, chatId) : null
    const checkers = input.status === 'done' ? await this.host.checkers() : []
    const { saved, created } = this.store.db.transaction(() => {
      const opened = input.itemId ? null : this.open(caller, input, chatId, session)
      const item = this.store.get(input.itemId ?? opened!.id)
      if (!item) throw new LilBotError('work_missing', 'No work item has that id.')
      if (item.ownerId !== callerId) throw new LilBotError('work_forbidden', 'Only the bot that owns an item reports on it.')
      const unchanged = { saved: { item, asked: null, ended: null }, created: false }
      if (isFinal(item.status) && input.status === item.status) return unchanged
      // While its check is open the owner's work stays as it was checked; the report that finished it is a retry.
      if (this.checks.byRequest(item.id, input.requestId)) return unchanged
      const open = this.checks.open(item.id)
      if (open) {
        const who = open.by.kind === 'oscar' ? "This item waits for Oscar's check" : `LilBot asked ${open.by.name} to check this item`
        throw new LilBotError('work_checking', `${who}; nothing more can be reported on it until the check ends. You will hear if it comes back.`)
      }
      const change = levelChange(item, input, kind => this.levels.floor(kind, callerId))
      if (input.title && input.title !== item.title) change.title = input.title
      if (!item.chatId && chatId) change.chatId = chatId
      // Opening with a definition (or at level 0) starts the work.
      const starts = !input.status && opened?.fresh && (input.done || (change.checkLevel ?? item.checkLevel) === 0)
      const status = input.status ?? (starts ? 'working' : undefined)
      const move = status && { status, question: input.question, result: input.result, reason: input.reason }
      return { saved: this.report(item, { ...input, move, checkers }, change, { by: 'bot', via: session?.origin ?? null }), created: !!opened?.created }
    })()
    this.after(saved)
    if (created && saved.item.origin.kind === 'conversation') this.host.line(saved.item)
    return this.view(saved.item.id)
  }

  /** The item an open call names. A retry finds the first one; the item LilBot opened for an exchange (no definition
   *  yet) is the one its receiver opens, and gives its kind. `fresh`: opened by this call. */
  private open(caller: { id: string; name: string }, input: WorkInput, chatId: string | null, session: SessionOrigin | null) {
    const prior = this.store.byRequest(caller.id, input.requestId)
    if (prior) return { id: prior.id, created: false, fresh: false }
    if (!chatId || !session) throw new LilBotError('no_conversation', 'LilBot could not tell which conversation this came from. Try again.')
    const exchange = session.origin.kind === 'exchange' ? this.store.get(session.origin.id) : null
    const ours = exchange?.ownerId === caller.id ? exchange : null
    if (ours && !isFinal(ours.status) && !ours.done) return { id: ours.id, created: false, fresh: true }
    if (!input.title) throw new LilBotError('work_no_title', 'Give a title to open an item, or an itemId to report on one.')
    if (!input.kind) throw noKind()
    const least = this.levels.floor(input.kind, caller.id)
    if (input.level !== undefined && input.level < least) throw belowDefault(input.kind, least)
    const asked: WorkAsker = session.askedBy ?? (input.asked === 'self' ? { kind: 'self', id: caller.id, name: caller.name } : { kind: 'oscar', id: null, name: 'Oscar' })
    const id = crypto.randomUUID()
    const at = this.now()
    this.store.create({
      id,
      ownerId: caller.id,
      ownerName: caller.name,
      requestId: input.requestId,
      title: input.title,
      done: '',
      kind: input.kind,
      checkLevel: input.level ?? least,
      defaultLevel: least,
      status: 'open',
      askedBy: asked,
      origin: session.origin,
      chatId,
      parentId: ours?.id ?? null,
      at
    })
    this.store.log(id, { at, by: 'bot', kind: 'opened', status: 'open', text: input.title, via: session.origin })
    return { id, created: true, fresh: true }
  }

  /** Applies one report inside the caller's transaction and refuses what the board does not allow. Final items take
   *  nothing more. */
  report(item: StoredItem, report: Report, change: ItemChange, actor: Actor): Saved {
    if (isFinal(item.status)) throw new LilBotError('work_final', `This item is ${item.status}; nothing more can be reported on it. Open a new item for new work.`)
    const at = this.now()
    const log = (kind: 'defined' | 'evidence' | 'status', status: StoredItem['status'] | null, text: string | null) =>
      this.store.log(item.id, { at, by: actor.by, kind, status, text, via: actor.via })
    const entries = (report.evidence ?? []).map(e => ({ e, pointer: pointerOf(e, id => this.host.libraryTitle(item.ownerId, id), at) }))
    if (report.done && report.done !== item.done) change.done = report.done
    // Repeating the current status changes nothing, except a second question while one waits, which is refused.
    const again = report.move?.status === item.status && !(item.status === 'needs_oscar' && report.move.question !== item.question)
    const move = again ? undefined : report.move
    const level = change.checkLevel ?? item.checkLevel
    if (move)
      Object.assign(change, transition({ ...item, kind: change.kind ?? item.kind, checkLevel: level }, move, change.done ?? item.done, item.evidenceCount + entries.length, at))
    if (change.status === 'done' && level >= 2) Object.assign(change, this.hold(item, level, report, at))
    const open = change.status && isFinal(change.status) && this.checks.open(item.id)
    if (open) this.checks.settle(open.id, 'dropped', null, null, at)
    if (change.done) log('defined', null, change.done)
    for (const [n, { e, pointer }] of entries.entries()) {
      if (this.store.addEvidence(item.id, { id: `${item.id}:${report.requestId ?? at}:${n}`, proves: e.proves, pointer, byId: item.ownerId, at })) log('evidence', null, e.proves)
    }
    const number = change.status ? log('status', change.status, change.question ?? change.result ?? change.dropReason ?? null) : null
    if (Object.keys(change).length || entries.length) this.store.update(item.id, change, at)
    const leaving = item.status === 'needs_oscar' && !!change.status && change.status !== 'needs_oscar'
    return { item: this.store.get(item.id)!, asked: change.status === 'needs_oscar' ? number : null, ended: leaving ? number : null }
  }

  /** A finished level 2 item waits for a second bot's check, chosen by LilBot; at level 3, or with no other bot, for
   *  Oscar's. The choice is saved with the item's move, before any check runs. */
  private hold(item: StoredItem, level: number, report: Report, at: number): ItemChange {
    const excluded = underItem(item, id => this.store.children(id))
    const bot = level === 2 ? chooseChecker(report.checkers ?? [], excluded, this.checks.checkersOf(item.id), this.checks.load()) : null
    this.checks.add(item.id, bot ? { kind: 'bot', ...bot } : OSCAR, report.requestId ?? null, level === 2 && !bot ? NO_CHECKER : null, at)
    return bot ? { status: 'checking', finishedAt: null } : { status: 'needs_oscar', question: reviewQuestion(level), finishedAt: null }
  }

  /** Once a report is saved: the bot's waiting state while an item needs Oscar, and the push to the board. */
  after({ item, asked, ended }: Saved) {
    if (asked !== null) this.host.waiting(item.ownerId, item.id, `ask-${asked}`, true)
    if (ended !== null) this.host.waiting(item.ownerId, item.id, `end-${ended}`, false)
    this.host.changed()
  }
}
