import type { Database } from 'bun:sqlite'
import { LilBotError } from '../../shared/lilbot-error'
import type { BotThread, ThreadMessage } from '../../shared/thread-schema'
import type { WebhookCapability } from '../../shared/webhook-schema'
import { type Accept, acceptDelivery, activeNarrowedCaps, assertNotWorker, WORK } from './thread-accept'
import { THREAD_LIMITS } from './thread-limits'

/** request, redirect and oscar (his answer to its question on its work item) are work for the receiver; answer is a reply back; notice is LilBot's own word.
 *  In a group, point is the leader's point for one member and round a round's replies for the leader. */
type DeliveryKind = 'request' | 'redirect' | 'oscar' | 'answer' | 'notice' | 'point' | 'round'
export const isWork = (kind: DeliveryKind) => kind === 'request' || kind === 'redirect' || kind === 'oscar'
export interface Delivery {
  id: string
  threadId: string
  sender: string
  target: string
  sourceChat: string
  text: string
  kind: DeliveryKind
  base: number | null
  /** pending until it has run; steered when it reached a running turn directly; stopping while confirming an interrupted/unknown turn stopped. */
  status: 'pending' | 'steered' | 'stopping' | 'done'
  chatId: string | null
}
type Bot = { id: string; name: string }
type SessionRoot = (botId: string, chatId: string) => string | null
export const FINAL = ['finished', 'failed', 'cancelled'] as const

export class ThreadStore {
  constructor(
    readonly db: Database,
    private rootOf?: SessionRoot
  ) {}
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
  private directContext(botId: string, chatId: string) {
    return this.db.query('SELECT thread_id FROM thread_chats WHERE bot_id=? AND chat_id=?').get(botId, chatId) as { thread_id: string } | null
  }
  /** The exchange or group this session belongs to, following compression continuations when `rootOf` is supplied. */
  context(botId: string, chatId: string): { thread_id: string } | null {
    const direct = this.directContext(botId, chatId)
    if (direct || !this.rootOf) return direct
    const root = this.rootOf(botId, chatId)
    return root && root !== chatId ? this.directContext(botId, root) : null
  }
  /** Like `context`, returning the thread, and failing closed (`session_unknown`) when compression lineage cannot be read. */
  parentThread(botId: string, chatId: string): BotThread | null {
    const direct = this.directContext(botId, chatId)
    if (direct) return this.get(direct.thread_id)
    if (!this.rootOf) return null
    const root = this.rootOf(botId, chatId)
    if (root === null) throw new LilBotError('session_unknown', 'LilBot cannot tell where this session came from just now. Try again in a moment.')
    const hit = root !== chatId ? this.directContext(botId, root) : null
    return hit ? this.get(hit.thread_id) : null
  }
  assertNotWorker(botId: string, chatId: string, startingWorker = false) {
    return assertNotWorker(this, botId, chatId, startingWorker)
  }
  session(threadId: string, botId: string): string | undefined {
    return (this.db.query('SELECT chat_id FROM thread_chats WHERE thread_id=? AND bot_id=? ORDER BY rowid LIMIT 1').get(threadId, botId) as { chat_id: string } | null)?.chat_id
  }
  isInternal(chatId: string) {
    return !!this.db.query('SELECT 1 FROM thread_chats WHERE chat_id=?').get(chatId)
  }
  /** Whether a worker thread's narrowed capabilities permit memory access (unrestricted or includes `memory`; unknown fails closed). */
  allowsWorkerMemory(threadId: string): boolean {
    try {
      const caps = this.get(threadId).capabilities
      return !caps || caps.includes('memory')
    } catch {
      return false
    }
  }
  /** Whether a thread/worker/group carries narrowed capabilities (unknown fails closed). */
  isNarrowed(threadId: string): boolean {
    const row = this.db.query("SELECT json_type(data, '$.capabilities') AS t FROM threads WHERE id=?").get(threadId) as { t: string | null } | null
    return !row || row.t === 'array'
  }
  /** Whether this bot has any thread/worker/group session carrying narrowed capabilities. */
  hasNarrowed(botId: string): boolean {
    return !!this.db.query("SELECT 1 FROM thread_chats c JOIN threads t ON t.id=c.thread_id WHERE c.bot_id=? AND json_type(t.data, '$.capabilities')='array' LIMIT 1").get(botId)
  }
  activeNarrowedCaps(botId: string, sessionCaps?: (botId: string, chatId: string) => WebhookCapability[] | null | undefined): WebhookCapability[] | null {
    return activeNarrowedCaps(this, botId, sessionCaps)
  }
  /** Narrowed capabilities of a thread session (following compression), null if unrestricted, undefined if lineage unreadable. */
  narrowedForChat(botId: string, chatId: string): WebhookCapability[] | null | undefined {
    const direct = this.directContext(botId, chatId)
    if (direct) return this.get(direct.thread_id).capabilities ?? null
    if (!this.rootOf) return null
    const root = this.rootOf(botId, chatId)
    if (root === null) return undefined
    const hit = root !== chatId ? this.directContext(botId, root) : null
    return hit ? (this.get(hit.thread_id).capabilities ?? null) : null
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
    return acceptDelivery(this, caller, target, input, record)
  }
  /** Exchanges this bot started that still have work queued or under way. */
  open(botId: string) {
    return (this.db.query(`SELECT count(DISTINCT threadId) AS n FROM thread_deliveries WHERE sender=? AND ${WORK} AND status!='done'`).get(botId) as { n: number }).n
  }
  /** Worker exchanges this bot started that still have work queued or under way. */
  openWorkers(botId: string) {
    return (
      this.db
        .query(
          `SELECT count(DISTINCT d.threadId) AS n FROM thread_deliveries d JOIN threads t ON t.id=d.threadId WHERE d.sender=? AND d.${WORK} AND d.status!='done' AND json_extract(t.data, '$.worker')=1`
        )
        .get(botId) as { n: number }
    ).n
  }
  origin(threadId: string, target: string): Delivery | null {
    return this.db.query("SELECT * FROM thread_deliveries WHERE threadId=? AND target=? AND kind='request' ORDER BY rowid DESC LIMIT 1").get(threadId, target) as Delivery | null
  }
  pending(): Delivery[] {
    return this.db.query("SELECT * FROM thread_deliveries WHERE status IN ('pending','stopping') ORDER BY rowid").all() as Delivery[]
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
