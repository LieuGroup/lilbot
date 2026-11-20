/** The durable outbox: runs each delivery in its bot's hidden session, keeps the exchange's status, and records what
 *  comes back. Transport failures retry the same engine admission, never a fresh turn. */
import type { ChatItem } from '../../shared/chat-schema'
import { LilBotError } from '../../shared/protocol'
import { backgroundFailure } from '../background'
import { botLine } from '../devices/origin-line'
import type { RoutineOptions } from '../engines/bot-engine'
import { memoryRefusal } from '../memory/memory-safety'
import { copyFile } from './exchange-files'
import type { ThreadFiles } from './thread-files'
import { THREAD_LIMITS } from './thread-limits'
import { answerPrompt, replyText, workPrompt } from './thread-prompts'
import type { Delivery, ThreadStore } from './thread-store'
import type { ThreadWaits } from './thread-waits'

type RunResult = { status: string; text: string; items?: ChatItem[] }
export interface RunnerHost {
  requireBot(id: string): Promise<{ id: string; name: string }>
  runRoutine(botId: string, prompt: string, options: RoutineOptions): Promise<RunResult>
  /** The bot's own folder, created if missing. Without it no files travel. */
  folder?(botId: string): Promise<string>
  stopRun?(botId: string, chatId: string): Promise<boolean>
}
const TERMINAL = ['bot_not_found', 'unsafe_message', 'thread_limit']

export class ThreadRunner {
  private running = new Map<string, Delivery>()
  private retryAt = new Map<string, number>()
  private lines = new Map<string, string>()
  constructor(
    private store: ThreadStore,
    private files: ThreadFiles,
    private waits: ThreadWaits,
    private host: RunnerHost,
    private changed: () => void,
    private activity: (d: Delivery, working: boolean) => void,
    /** A light push: an exchange's status or activity line changed. */
    private touched: () => void
  ) {}

  /** The delivery running now in this exchange's receiver session, if any. */
  runningFor(threadId: string) {
    return [...this.running.values()].find(d => this.store.workThread(d) === threadId)
  }
  activityOf(threadId: string) {
    return this.lines.get(threadId) ?? null
  }
  /** A tool call seen in a chat: in a running exchange it becomes the receiver's activity line. */
  sawTool(chatId: string, line: string) {
    const d = [...this.running.values()].find(d => d.chatId === chatId)
    const work = d && this.store.workThread(d)
    if (!work || this.lines.get(work) === line) return
    this.lines.set(work, line)
    this.touched()
  }

  tick() {
    const pending = this.store.pending()
    for (const [index, d] of pending.entries()) {
      if (this.running.size >= THREAD_LIMITS.concurrent) break
      if (this.running.has(d.id) || (this.retryAt.get(d.id) ?? 0) > Date.now()) continue
      // Preserve order within a thread, while nested threads can make progress independently.
      if (pending.slice(0, index).some(other => other.threadId === d.threadId)) continue
      this.running.set(d.id, d)
      void Promise.resolve()
        .then(() => {
          this.activity(d, true)
          return this.run(d)
        })
        .catch(error => {
          if (error instanceof LilBotError && error.code === 'thread_cancelled') this.store.setStatus(d.id, 'done')
          else if (error instanceof LilBotError && TERMINAL.includes(error.code)) this.fail(d)
          else {
            this.retryAt.set(d.id, Date.now() + 30_000)
            backgroundFailure('thread delivery')
          }
        })
        .finally(() => {
          this.running.delete(d.id)
          const work = this.store.workThread(d)
          if (work) this.lines.delete(work)
          this.activity(d, false)
          this.changed()
        })
        .catch(() => backgroundFailure('thread delivery cleanup'))
    }
  }

  private async run(d: Delivery) {
    await this.host.requireBot(d.sender)
    await this.host.requireBot(d.target)
    const work = this.store.workThread(d)
    const stopped = () => !!work && this.store.get(work).status === 'cancelled'
    const stillOn = () => {
      if (stopped()) throw new LilBotError('thread_cancelled', 'The exchange was stopped.')
    }
    // Stopped before this turn ran, or while LilBot was down: make sure its session is not left running.
    if (stopped() && d.chatId) await this.host.stopRun?.(d.target, d.chatId)
    stillOn()
    const thread = this.store.get(d.threadId)
    const sender = thread.participants.find(p => p.id === d.sender)?.name ?? 'a bot'
    if (d.kind !== 'notice') {
      if (d.text.length > THREAD_LIMITS.text) throw new LilBotError('unsafe_message', 'The answer exceeds the thread text limit.')
      if (memoryRefusal(d.text)) throw new LilBotError('unsafe_message', 'Unsafe bot message withheld.')
    }
    const redirects = d.kind === 'request' ? this.store.redirectsAfter(d) : []
    const files = this.files.forMessage(d.id)
    const prompt =
      d.kind === 'notice'
        ? d.text
        : d.kind === 'answer'
          ? answerPrompt(thread, sender, d.text, files, this.waits.foldedInto(d.id))
          : workPrompt(d, thread, sender, files, redirects)
    const toWork = d.kind === 'request' || d.kind === 'redirect'
    const internal = toWork || !!this.store.context(d.target, d.sourceChat)
    if (work) this.store.update(work, t => t.status !== 'working' && Object.assign(t, { status: 'working', startedAt: Date.now(), endedAt: null }))
    this.touched()
    const result = await this.host.runRoutine(d.target, prompt, {
      runId: `thread-${d.id}`,
      chatId: toWork ? this.store.session(d.threadId, d.target) : d.sourceChat,
      onChat: id => {
        stillOn()
        this.store.attach(d, d.target, id, internal)
        d.chatId = id
      },
      baseline: length => {
        stillOn()
        return this.store.baseline(d.id, length)
      },
      origin: { line: botLine },
      hiddenInput: true
    })
    await this.finish(d, redirects, result)
  }

  private responseFor(d: Delivery) {
    if (d.kind === 'request' || d.kind === 'redirect') return { target: d.sender, sourceChat: d.sourceChat, threadId: d.threadId }
    const parent = d.kind === 'answer' ? this.store.context(d.target, d.sourceChat) : null
    const origin = parent && this.store.origin(parent.thread_id, d.target)
    return origin ? { target: origin.sender, sourceChat: origin.sourceChat, threadId: parent.thread_id } : null
  }

  private async finish(d: Delivery, redirects: Delivery[], result: RunResult) {
    const items = result.items?.filter(i => i.kind !== 'user') ?? [{ kind: 'assistant' as const, text: result.text }]
    if (result.status !== 'completed') items.push({ kind: 'assistant', text: `Thread work ${result.status}: ${result.text}` })
    // A redirect steered into this turn that the turn never took runs as the receiver's next turn instead.
    for (const r of this.store.steered(d.threadId))
      if (r.target === d.target) this.store.setStatus(r.id, result.items?.some(i => i.kind === 'user' && i.text.includes(r.id)) ? 'done' : 'pending')
    const response = this.responseFor(d)
    const replyId = `${d.id}:reply`
    const withheld = !!response && this.store.get(response.threadId).status === 'cancelled'
    if (response && !withheld) await this.sendFiles(replyId, d.target, response.target)
    const settled = [d, ...redirects].map(r => r.id)
    this.store.db.transaction(() => {
      if (this.store.delivery(d.id)?.status === 'done') return
      if (response) {
        const thread = this.store.get(response.threadId)
        const author = thread.participants.find(p => p.id === d.target)!
        const reply = { id: replyId, authorId: author.id, authorName: author.name, createdAt: Date.now(), items, ...(withheld ? { withheld: true as const } : {}) }
        const sent = this.store.append(thread, reply) && !withheld
        if (sent) this.store.enqueue(replyId, thread.id, d.target, response.target, response.sourceChat, replyText(items), 'answer')
        if (!withheld) {
          const more = this.store.pendingWork(thread.id).some(id => !settled.includes(id))
          thread.status = result.status === 'completed' ? (more ? 'waiting' : 'finished') : result.status === 'stopped' ? 'cancelled' : 'failed'
          thread.endedAt = Date.now()
        }
        this.store.save(thread)
        if (!withheld) this.waits.settle(thread.id, sent ? { id: replyId, target: response.target, sourceChat: response.sourceChat } : null)
      }
      for (const id of settled) this.store.setStatus(id, 'done')
    })()
    this.retryAt.delete(d.id)
  }

  /** Files the receiver attached to this reply, copied into the recipient's folder as the answer goes out. */
  private async sendFiles(messageId: string, from: string, to: string) {
    const rows = this.files.forMessage(messageId).filter(f => !f.copy)
    if (!rows.length || !this.host.folder) return
    const [fromRoot, toRoot] = [await this.host.folder(from), await this.host.folder(to)]
    for (const row of rows) {
      try {
        const copy = await copyFile(fromRoot, row.source, toRoot, row.thread_id)
        this.files.copied(row.id, copy.copy, copy.sha256)
      } catch (error) {
        // A file that disappeared or became a link since it was attached is listed as not delivered.
        if (!(error instanceof LilBotError)) throw error
      }
    }
  }

  private fail(d: Delivery) {
    this.store.db.transaction(() => {
      const thread = this.store.get(d.threadId)
      Object.assign(thread, { state: 'failed', status: 'failed', endedAt: Date.now() })
      this.store.save(thread)
      this.store.setStatus(d.id, 'done')
      this.waits.settle(thread.id, null)
    })()
  }
}
