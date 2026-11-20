/** Exchanges between bots: asking (`ask`, for sessions that loaded plug-in 0.9.x through the engine API), reading (bots and
 *  Oscar), and stopping (the delegating bot or Oscar). Running the deliveries is `thread-runner.ts`; the delegation tools on
 *  LilBot's MCP server are `delegation-service.ts`. */
import { LilBotError } from '../../shared/protocol'
import { type BotThread, ThreadAsk } from '../../shared/thread-schema'
import { backgroundFailure } from '../background'
import { ThreadFiles } from './thread-files'
import { noticePrompt, refuseUnsafe } from './thread-prompts'
import { type RunnerHost, ThreadRunner } from './thread-runner'
import { type Delivery, FINAL, type ThreadStore } from './thread-store'
import { ThreadWaits } from './thread-waits'

export interface ThreadHost extends RunnerHost {
  listBots(): Promise<{ id: string; name: string }[]>
}
export type StoppedBy = { kind: 'bot'; id: string; name: string } | { kind: 'oscar'; id: null; name: 'Oscar' }

export class ThreadService {
  readonly runner: ThreadRunner
  readonly files: ThreadFiles
  readonly waits: ThreadWaits
  constructor(
    readonly store: ThreadStore,
    private host: ThreadHost,
    readonly changed: () => void = () => {},
    activity: (d: Delivery, working: boolean) => void = () => {},
    touched: () => void = () => {}
  ) {
    this.files = new ThreadFiles(store.db)
    this.waits = new ThreadWaits(store)
    this.runner = new ThreadRunner(store, this.files, this.waits, host, changed, activity, touched)
  }
  tick() {
    this.runner.tick()
  }
  /** The stored exchange with its files per message and the receiver's live activity line. */
  view(thread: BotThread): BotThread {
    const files = this.files.byMessage(thread.id)
    return {
      ...thread,
      activity: thread.status === 'working' ? this.runner.activityOf(thread.id) : null,
      messages: thread.messages.map(m => (files.has(m.id) ? { ...m, files: files.get(m.id) } : m))
    }
  }
  async list(botId: string) {
    await this.host.requireBot(botId)
    return this.store.list(botId).map(thread => this.view(thread))
  }
  async open(botId: string, id: string) {
    await this.host.requireBot(botId)
    const thread = this.store.get(id)
    if (!thread.participants.some(p => p.id === botId)) throw new LilBotError('thread_forbidden', 'This bot is not a participant.')
    return this.view(thread)
  }
  /** Resolves `to` (an id or a unique name) among current bots. */
  async target(to: string) {
    const matches = (await this.host.listBots()).filter(b => b.id === to || b.name === to)
    if (matches.length !== 1) throw new LilBotError('thread_target', 'Choose an exact bot id or unique bot name from lilbot_bots_list.')
    return matches[0]
  }
  async ask(callerId: string, raw: ThreadAsk) {
    const input = ThreadAsk.parse(raw)
    const caller = await this.host.requireBot(callerId)
    const prior = this.store.delivery(`${callerId}:${input.requestId}`)
    if (prior) return { threadId: prior.threadId, queued: true }
    refuseUnsafe(input.text)
    const delivery = this.store.accept(caller, await this.target(input.to), input)
    this.changed()
    return { threadId: delivery.threadId, queued: true }
  }
  /** The database part of stopping an exchange under way, so a caller can do it inside its own transaction: work queued for the
   *  receiver is dropped, and anything its running turn still says stays in the record without being delivered. When Oscar stops
   *  it, the delegating bot is told. Null when the exchange has settled already; `end` then interrupts the receiver's turn. */
  stopping(threadId: string, by: StoppedBy, reason?: string) {
    const thread = this.store.get(threadId)
    if (by.kind === 'bot' && thread.participants[0].id !== by.id) throw new LilBotError('thread_forbidden', 'Only the bot that handed over this work can stop it.')
    if ((FINAL as readonly string[]).includes(thread.status)) return null
    const receiver = thread.participants[1]
    const running = this.runner.runningFor(threadId)
    const stopped = this.store.db.transaction(() => {
      const next = this.store.update(threadId, t => Object.assign(t, { status: 'cancelled', endedAt: Date.now(), stoppedBy: { ...by, at: Date.now() } }))
      // The running turn settles itself when it ends, so what it says is still recorded (as withheld).
      for (const id of this.store.pendingWork(threadId)) if (id !== running?.id) this.store.setStatus(id, 'done')
      if (by.kind === 'oscar')
        this.tellDelegator(
          next,
          `stopped:${threadId}:${next.messages.length}`,
          `Oscar stopped the task you handed to ${JSON.stringify(receiver.name)} (exchange ${threadId})${reason ? `, saying ${JSON.stringify(reason)}` : ''}. Its answer will not come.`
        )
      this.waits.settle(threadId, null)
      return next
    })()
    const end = async () => {
      if (running?.chatId) await this.host.stopRun?.(running.target, running.chatId).catch(() => backgroundFailure('thread stop'))
      this.changed()
    }
    return { thread: stopped, end }
  }
  async cancel(threadId: string, by: StoppedBy) {
    const stop = this.stopping(threadId, by)
    if (!stop) return this.view(this.store.get(threadId))
    await stop.end()
    return this.view(stop.thread)
  }

  /** Oscar answered the receiver's question on its work item: its next turn in this exchange, so what it says then comes back to
   *  the delegating bot like any answer. Refuses like `accept` when the exchange cannot take another message. */
  oscarAnswer(threadId: string, id: string, prompt: string) {
    const [delegator, receiver] = this.store.get(threadId).participants
    const origin = this.store.origin(threadId, receiver.id)
    if (!origin) throw new LilBotError('thread_missing', 'That exchange has no request to continue.')
    this.store.accept(delegator, receiver, { requestId: id, text: prompt, chatId: origin.sourceChat, threadId, kind: 'oscar' })
  }

  /** Oscar dropped the work item this exchange was handed out as. A running exchange is stopped, with the same database part as
   *  `cancel`; one that has settled only tells the delegating bot. Returns what ends the receiver's turn once the caller commits. */
  dropped(threadId: string, reason: string) {
    const stop = this.stopping(threadId, { kind: 'oscar', id: null, name: 'Oscar' }, reason)
    if (stop) return stop.end
    const thread = this.store.get(threadId)
    this.tellDelegator(
      thread,
      `dropped:${threadId}`,
      `Oscar dropped the work item of the task you handed to ${JSON.stringify(thread.participants[1].name)} (exchange ${threadId}), saying ${JSON.stringify(reason)}. Its work is no longer wanted.`
    )
    return async () => {}
  }

  /** LilBot's word to the delegating bot, in the conversation it handed the work from. */
  private tellDelegator(thread: BotThread, id: string, text: string) {
    const [delegator, receiver] = thread.participants
    const origin = this.store.origin(thread.id, receiver.id)
    if (origin) this.store.enqueue(id, thread.id, delegator.id, delegator.id, origin.sourceChat, noticePrompt(text), 'notice')
  }
}
