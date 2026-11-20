/** The durable outbox: runs each delivery in its bot's hidden session, keeps the exchange's status, and records what
 *  comes back. Transport failures retry the same engine admission, never a fresh turn. */
import type { ChatItem } from '../../shared/chat-schema'
import { LilBotError } from '../../shared/protocol'
import { backgroundFailure } from '../background'
import { botLine } from '../devices/origin-line'
import type { RoutineOptions } from '../engines/bot-engine'
import { memoryRefusal } from '../memory/memory-safety'
import { sendFiles } from './exchange-files'
import type { GroupRounds } from './group-rounds'
import type { ThreadFiles } from './thread-files'
import { THREAD_LIMITS } from './thread-limits'
import { answerPrompt, replyText, workPrompt } from './thread-prompts'
import { type Delivery, isWork, type ThreadStore } from './thread-store'
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
/** Kinds whose text is LilBot's own prompt, any bot text in it already checked and fenced. */
const PREPARED = ['notice', 'oscar', 'point', 'round']

export class ThreadRunner {
  readonly running = new Map<string, Delivery>()
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
    private touched: () => void,
    private groups?: GroupRounds
  ) {}

  /** The deliveries running now in this exchange's (or group's) sessions. */
  runningIn(threadId: string) {
    return [...this.running.values()].filter(d => this.store.workThread(d) === threadId)
  }
  runningFor(threadId: string) {
    return this.runningIn(threadId)[0]
  }
  /** What the bot running this delivery is doing right now. */
  lineOf(d: Delivery | undefined) {
    return (d && this.lines.get(d.id)) ?? null
  }
  /** A tool call seen in a chat: in a running exchange it becomes the receiver's activity line. */
  sawTool(chatId: string, line: string) {
    const d = [...this.running.values()].find(d => d.chatId === chatId)
    if (!d || this.lines.get(d.id) === line) return
    this.lines.set(d.id, line)
    this.touched()
  }

  tick() {
    const pending = this.store.pending()
    // In order within a thread, and within a group per member so members reply in parallel; nested threads move independently.
    const lanes = pending.map(d => {
      const group = this.groups?.groupOf(d)
      return group ? `${group}\n${d.target}` : d.threadId
    })
    for (const [index, d] of pending.entries()) {
      if (this.running.size >= THREAD_LIMITS.concurrent) break
      if (this.running.has(d.id) || (this.retryAt.get(d.id) ?? 0) > Date.now()) continue
      if (lanes.slice(0, index).includes(lanes[index])) continue
      this.running.set(d.id, d)
      void Promise.resolve()
        .then(() => {
          this.activity(d, true)
          return this.run(d)
        })
        .catch(error => {
          if (error instanceof LilBotError && error.code === 'thread_cancelled') this.store.setStatus(d.id, 'done')
          else if (error instanceof LilBotError && TERMINAL.includes(error.code)) return this.groups?.owns(d.threadId) ? this.groups.failed(d) : this.fail(d)
          else {
            this.retryAt.set(d.id, Date.now() + 30_000)
            backgroundFailure('thread delivery')
          }
        })
        .finally(() => {
          this.running.delete(d.id)
          this.lines.delete(d.id)
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
    const group = this.groups?.groupOf(d)
    const stopped = () => !!work && (group ? this.groups!.ended(group) : this.store.get(work).status === 'cancelled')
    const stillOn = () => {
      if (stopped()) throw new LilBotError('thread_cancelled', 'The exchange was stopped.')
    }
    // Stopped before this turn ran, or while LilBot was down: make sure its session is not left running.
    if (stopped() && d.chatId) await this.host.stopRun?.(d.target, d.chatId)
    stillOn()
    const thread = this.store.get(d.threadId)
    const sender = thread.participants.find(p => p.id === d.sender)?.name ?? 'a bot'
    if (!PREPARED.includes(d.kind)) {
      if (d.text.length > THREAD_LIMITS.text) throw new LilBotError('unsafe_message', 'The answer exceeds the thread text limit.')
      if (memoryRefusal(d.text)) throw new LilBotError('unsafe_message', 'Unsafe bot message withheld.')
    }
    const redirects = d.kind === 'request' ? this.store.redirectsAfter(d) : []
    const files = this.files.forMessage(d.id)
    const prompt = PREPARED.includes(d.kind)
      ? d.text
      : d.kind === 'answer'
        ? answerPrompt(thread, sender, d.text, files, this.waits.foldedInto(d.id))
        : workPrompt(d, thread, sender, files, redirects)
    const toWork = d.kind !== 'answer' && d.kind !== 'notice'
    const internal = toWork || !!this.store.context(d.target, d.sourceChat)
    if (work && !group) this.store.update(work, t => t.status !== 'working' && Object.assign(t, { status: 'working', startedAt: Date.now(), endedAt: null }))
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
    if (isWork(d.kind)) return { target: d.sender, sourceChat: d.sourceChat, threadId: d.threadId }
    const parent = d.kind === 'answer' ? this.store.context(d.target, d.sourceChat) : null
    const origin = parent && this.store.origin(parent.thread_id, d.target)
    return origin ? { target: origin.sender, sourceChat: origin.sourceChat, threadId: parent.thread_id } : null
  }

  private async finish(d: Delivery, redirects: Delivery[], result: RunResult) {
    const items = result.items?.filter(i => i.kind !== 'user') ?? [{ kind: 'assistant' as const, text: result.text }]
    if (result.status !== 'completed') items.push({ kind: 'assistant', text: `Thread work ${result.status}: ${result.text}` })
    const group = this.groups?.groupOf(d)
    if (group) return this.groups!.record(d, group, items).then(() => this.retryAt.delete(d.id))
    // A redirect steered into this turn that the turn never took runs as the receiver's next turn instead.
    const work = this.store.workThread(d)
    for (const r of work ? this.store.steered(work) : [])
      if (r.target === d.target) this.store.setStatus(r.id, result.items?.some(i => i.kind === 'user' && i.text.includes(r.id)) ? 'done' : 'pending')
    const response = this.responseFor(d)
    const replyId = `${d.id}:reply`
    const withheld = !!response && this.store.get(response.threadId).status === 'cancelled'
    if (response && !withheld && this.host.folder) await sendFiles(this.files, this.host.folder, replyId, d.target, response.target)
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
