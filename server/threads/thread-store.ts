import type { Database } from 'bun:sqlite'
import { LilBotError } from '../../shared/protocol'
import type { BotThread, ThreadMessage } from '../../shared/thread-schema'
import { THREAD_LIMITS } from './thread-limits'

/** request, redirect and oscar (his answer to its question on its work item) are work for the receiver; answer is a reply back; notice is LilBot's own word.
 *  In a group, point is the leader's point for one member and round a round's replies for the leader. */
type DeliveryKind = 'request' | 'redirect' | 'oscar' | 'answer' | 'notice' | 'point' | 'round'
export const isWork = (kind: DeliveryKind) => kind === 'request' || kind === 'redirect' || kind === 'oscar'
const WORK = "kind IN ('request','redirect','oscar')"
export interface Delivery {
  id: string
  threadId: string
  sender: string
  target: string
  sourceChat: string
  text: string
  kind: DeliveryKind
  base: number | null
  /** pending until it has run; steered when it reached a running turn directly. */
  status: 'pending' | 'steered' | 'done'
  chatId: string | null
}
export interface Accept {
  requestId: string
  text: string
  chatId: string
  threadId?: string
  /** The id a new thread gets, so files can be copied before it exists. */
  newId?: string
  batchId?: string | null
  /** The delegating bot's work item a new exchange is handed out under. */
  parentId?: string | null
  kind?: 'request' | 'redirect' | 'oscar'
}
type Bot = { id: string; name: string }
export const FINAL = ['finished', 'failed', 'cancelled'] as const

export class ThreadStore {
  constructor(readonly db: Database) {}
  get(id: string): BotThread {
    const row = this.db.query('SELECT data, batch_id, parent_id FROM threads LEFT JOIN thread_links ON thread_id=id WHERE id=?').get(id) as {
      data: string
      batch_id: string | null
      parent_id: string | null
    } | null
    if (!row) throw new LilBotError('thread_missing', 'Thread not found.')
    const stored = JSON.parse(row.data)
    // Threads from before delegation carry no status: they ran once, to an answer or a failure.
    const status = stored.state === 'failed' ? 'failed' : 'finished'
    return { status, startedAt: null, endedAt: null, stoppedBy: null, ...stored, batchId: row.batch_id, parentId: row.parent_id, activity: null }
  }
  save({ batchId, parentId, activity, ...thread }: BotThread) {
    this.db.query('INSERT INTO threads(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(thread.id, JSON.stringify(thread))
  }
  update(id: string, change: (thread: BotThread) => void) {
    return this.db.transaction(() => {
      const thread = this.get(id)
      change(thread)
      this.save(thread)
      return thread
    })()
  }
  list(botId: string): BotThread[] {
    return (this.db.query('SELECT id, data FROM threads ORDER BY rowid DESC').all() as { id: string; data: string }[])
      .filter(r => (JSON.parse(r.data).participants as Bot[]).some(p => p.id === botId))
      .map(r => this.get(r.id))
  }
  batch(batchId: string): string[] {
    return (this.db.query('SELECT thread_id FROM thread_links WHERE batch_id=? ORDER BY rowid').all(batchId) as { thread_id: string }[]).map(r => r.thread_id)
  }
  context(botId: string, chatId: string) {
    return this.db.query('SELECT thread_id FROM thread_chats WHERE bot_id=? AND chat_id=?').get(botId, chatId) as { thread_id: string } | null
  }
  session(threadId: string, botId: string): string | undefined {
    return (this.db.query('SELECT chat_id FROM thread_chats WHERE thread_id=? AND bot_id=? ORDER BY rowid LIMIT 1').get(threadId, botId) as { chat_id: string } | null)?.chat_id
  }
  isInternal(chatId: string) {
    return !!this.db.query('SELECT 1 FROM thread_chats WHERE chat_id=?').get(chatId)
  }
  delivery(id: string): Delivery | null {
    return this.db.query('SELECT * FROM thread_deliveries WHERE id=?').get(id) as Delivery | null
  }
  /** The thread whose receiver works when this delivery runs: its own for work, the asking context for an answer. */
  workThread(d: Delivery): string | null {
    if (d.kind !== 'answer' && d.kind !== 'notice') return d.threadId
    return d.kind === 'answer' ? (this.context(d.target, d.sourceChat)?.thread_id ?? null) : null
  }
  accept(caller: Bot, target: Bot, input: Accept, record?: (id: string, thread: BotThread) => void) {
    return this.db.transaction(() => {
      const id = `${caller.id}:${input.requestId}`
      const prior = this.delivery(id)
      if (prior) return prior
      if (caller.id === target.id) throw new LilBotError('thread_self', 'You cannot ask yourself.')
      const parent = this.context(caller.id, input.chatId)
      const depth = parent ? this.get(parent.thread_id).depth + 1 : 1
      const thread: BotThread = input.threadId
        ? this.get(input.threadId)
        : {
            id: input.newId ?? crypto.randomUUID(),
            participants: [caller, target].map(({ id, name }) => ({ id, name })),
            createdAt: Date.now(),
            depth,
            state: 'open',
            messages: [],
            batchId: input.batchId ?? null,
            parentId: input.parentId ?? null,
            status: 'waiting',
            activity: null,
            startedAt: null,
            endedAt: null,
            stoppedBy: null
          }
      if (thread.group) throw new LilBotError('thread_forbidden', 'That is a group: use lilbot_group.')
      if (!thread.participants.some(p => p.id === caller.id) || !thread.participants.some(p => p.id === target.id))
        throw new LilBotError('thread_forbidden', 'Only the two participants can use this thread.')
      if ((!input.threadId && depth > THREAD_LIMITS.depth) || thread.depth > THREAD_LIMITS.depth)
        throw new LilBotError('thread_depth', 'Maximum thread depth reached. Report back to whoever asked you.')
      if (!input.threadId && this.open(caller.id) >= THREAD_LIMITS.openPerBot)
        throw new LilBotError('thread_limit', `You already have ${THREAD_LIMITS.openPerBot} delegations under way. Wait for answers or stop one first.`)
      // Pending requests reserve their answer; continuations reserve through append below.
      const pending = (this.db.query(`SELECT count(*) AS n FROM thread_deliveries WHERE threadId=? AND ${WORK} AND status!='done'`).get(thread.id) as { n: number }).n
      if (thread.state !== 'open' || thread.messages.length + pending + 2 > THREAD_LIMITS.messages)
        throw new LilBotError('thread_limit', 'Thread message limit reached. Report back to whoever asked you.')
      const kind = input.kind ?? 'request'
      thread.messages.push({
        id,
        authorId: caller.id,
        authorName: caller.name,
        createdAt: Date.now(),
        items: [{ kind: 'assistant', text: input.text }],
        ...(kind === 'redirect' ? { redirect: true } : kind === 'oscar' ? { oscar: true } : {})
      })
      if (thread.status !== 'working') Object.assign(thread, { status: 'waiting', endedAt: null })
      this.save(thread)
      if (!input.threadId)
        this.db.query('INSERT OR IGNORE INTO thread_links(thread_id,batch_id,parent_id) VALUES(?,?,?)').run(thread.id, input.batchId ?? null, input.parentId ?? null)
      this.db
        .query('INSERT INTO thread_deliveries(id,threadId,sender,target,sourceChat,text,kind) VALUES(?,?,?,?,?,?,?)')
        .run(id, thread.id, caller.id, target.id, input.chatId, input.text, kind)
      record?.(id, thread)
      return this.delivery(id)!
    })()
  }
  /** Exchanges this bot started that still have work queued or under way. */
  open(botId: string) {
    return (this.db.query(`SELECT count(DISTINCT threadId) AS n FROM thread_deliveries WHERE sender=? AND ${WORK} AND status!='done'`).get(botId) as { n: number }).n
  }
  origin(threadId: string, target: string): Delivery | null {
    return this.db.query("SELECT * FROM thread_deliveries WHERE threadId=? AND target=? AND kind='request' ORDER BY rowid DESC LIMIT 1").get(threadId, target) as Delivery | null
  }
  pending(): Delivery[] {
    return this.db.query("SELECT * FROM thread_deliveries WHERE status='pending' ORDER BY rowid").all() as Delivery[]
  }
  /** Redirects queued behind a request that has not started: they join its first turn. */
  redirectsAfter(d: Delivery): Delivery[] {
    return this.db
      .query(
        "SELECT * FROM thread_deliveries WHERE threadId=? AND target=? AND kind='redirect' AND status='pending' AND rowid>(SELECT rowid FROM thread_deliveries WHERE id=?) ORDER BY rowid"
      )
      .all(d.threadId, d.target, d.id) as Delivery[]
  }
  /** Work queued or under way in this thread: requests and redirects not yet done. */
  pendingWork(threadId: string): string[] {
    return (this.db.query(`SELECT id FROM thread_deliveries WHERE threadId=? AND ${WORK} AND status!='done'`).all(threadId) as { id: string }[]).map(r => r.id)
  }
  /** A redirect that did not reach the running turn waits for the receiver's next step. */
  redirectWaiting(threadId: string) {
    return !!this.db.query("SELECT 1 FROM thread_deliveries WHERE threadId=? AND kind='redirect' AND status='pending'").get(threadId)
  }
  steered(threadId: string): Delivery[] {
    return this.db.query("SELECT * FROM thread_deliveries WHERE threadId=? AND status='steered' ORDER BY rowid").all(threadId) as Delivery[]
  }
  setStatus(id: string, status: Delivery['status'], chatId?: string) {
    this.db.query('UPDATE thread_deliveries SET status=?, chatId=coalesce(?,chatId) WHERE id=?').run(status, chatId ?? null, id)
  }
  attach(d: Delivery, botId: string, chatId: string, internal: boolean) {
    const context = d.kind === 'answer' || d.kind === 'notice' ? this.context(botId, d.sourceChat)?.thread_id : d.threadId
    if (internal && context) this.db.query('INSERT OR IGNORE INTO thread_chats(chat_id,bot_id,thread_id) VALUES(?,?,?)').run(chatId, botId, context)
    this.db.query('UPDATE thread_deliveries SET chatId=? WHERE id=?').run(chatId, d.id)
  }
  baseline(id: string, length: number) {
    this.db.query('UPDATE thread_deliveries SET base=coalesce(base,?) WHERE id=?').run(length, id)
    return this.delivery(id)!.base!
  }
  /** Appends a message within the thread's limit; false when the thread is full. */
  append(thread: BotThread, message: ThreadMessage) {
    if (thread.messages.length >= THREAD_LIMITS.messages) return false
    thread.messages.push(message)
    if (thread.messages.length >= THREAD_LIMITS.messages) thread.state = 'limited'
    return true
  }
  /** Queues `text` from `sender` into `target`'s chat, unless that delivery already exists. */
  enqueue(id: string, threadId: string, sender: string, target: string, sourceChat: string, text: string, kind: Exclude<DeliveryKind, 'request' | 'redirect'>) {
    this.db
      .query('INSERT OR IGNORE INTO thread_deliveries(id,threadId,sender,target,sourceChat,text,kind) VALUES(?,?,?,?,?,?,?)')
      .run(id, threadId, sender, target, sourceChat, text, kind)
  }
}
