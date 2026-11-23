/** Accepting a new or continuing exchange delivery inside a single transaction, enforcing self, worker-nesting, depth and open caps. */
import type { BotModel, ReasoningEffort } from '../../shared/bot-schema'
import { LilBotError } from '../../shared/lilbot-error'
import type { BotThread } from '../../shared/thread-schema'
import type { WebhookCapability } from '../../shared/webhook-schema'
import { AMBIGUOUS, AMBIGUOUS_MATCH, type Match, NOT_SEEN } from './calling-chats'
import { THREAD_LIMITS } from './thread-limits'
import type { Delivery, ThreadStore } from './thread-store'

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
  worker?: boolean
  model?: BotModel
  reasoningEffort?: ReasoningEffort
  computer?: string
  computerName?: string
  cwd?: string
  capabilities?: WebhookCapability[]
}
type Bot = { id: string; name: string }
export const WORK = "kind IN ('request','redirect','oscar')"

/** Whether a narrowed run's capabilities cover an existing exchange or group (true when unrestricted). */
export function withinNarrowed(capabilities: WebhookCapability[] | null | undefined, existing: Pick<BotThread, 'computer' | 'capabilities'>): boolean {
  if (!capabilities) return true
  if (existing.computer && !capabilities.includes('computers')) return false
  return existing.capabilities !== undefined && !existing.capabilities.some(c => !capabilities.includes(c))
}

/** Refuses a narrowed run from naming a computer without `computers` or entering a broader exchange/group. */
export function assertNarrowedAllowed(capabilities: WebhookCapability[] | null | undefined, opts: { computer?: string; existing?: Pick<BotThread, 'computer' | 'capabilities'> }) {
  if (!capabilities) return
  if ((opts.computer || opts.existing?.computer) && !capabilities.includes('computers'))
    throw new LilBotError('capability_denied', 'A narrowed run cannot delegate to a computer without the "computers" capability.')
  if (opts.existing && !withinNarrowed(capabilities, opts.existing))
    throw new LilBotError('capability_denied', 'A narrowed run cannot continue an exchange or group with broader access than its own.')
}

/** Resolves a caller's narrowed capabilities when this bot has any narrowed session active; fails closed if unplaced or ambiguous. */
export async function narrowedCaller(
  botId: string,
  host: { hasNarrowed?(botId: string): boolean; sessionCapabilities?(botId: string, chatId: string | undefined): WebhookCapability[] | null },
  place: () => Promise<Match>
): Promise<WebhookCapability[] | null> {
  if (!host.hasNarrowed?.(botId)) return null
  const chatId = await place()
  if (chatId === AMBIGUOUS_MATCH) throw new LilBotError('session_ambiguous', AMBIGUOUS)
  if (!chatId) throw new LilBotError('session_unknown', NOT_SEEN)
  return host.sessionCapabilities?.(botId, chatId) ?? null
}

/** Intersection of capabilities across currently-live local narrowed deliveries for `botId`, or null when none are live.
 *  Remote workers (`computer` set) are excluded because they only reach `worker-mcp.ts` (scoped by `ctx.threadId`). */
export function activeNarrowedCaps(store: ThreadStore, botId: string): WebhookCapability[] | null {
  const rows = store.db.query("SELECT threadId, kind, sourceChat FROM thread_deliveries WHERE target=? AND status!='done'").all(botId) as Pick<
    Delivery,
    'threadId' | 'kind' | 'sourceChat'
  >[]
  let caps: WebhookCapability[] | null = null
  const intersect = (next: WebhookCapability[]) => {
    caps = caps === null ? [...next] : caps.filter(c => next.includes(c))
  }
  for (const row of rows) {
    if (row.kind === 'answer' || row.kind === 'notice') {
      const parent = store.narrowedForChat(botId, row.sourceChat)
      if (parent === undefined) return []
      if (parent !== null) intersect(parent)
      continue
    }
    const thread = store.get(row.threadId)
    if (thread.capabilities !== undefined && !thread.computer) intersect(thread.capabilities)
  }
  return caps
}

/** Throws when `chatId` belongs to a worker session (or its compression continuation), or when its lineage cannot be read. */
export function assertNotWorker(store: ThreadStore, botId: string, chatId: string, startingWorker = false) {
  const parent = store.parentThread(botId, chatId)
  if (!parent?.worker) return parent
  throw new LilBotError(
    'thread_worker_nested',
    startingWorker ? 'A worker cannot start another worker. Do the work yourself or report back.' : 'A worker cannot delegate work. Do the work yourself or report back.'
  )
}

export function acceptDelivery(store: ThreadStore, caller: Bot, target: Bot, input: Accept, record?: (id: string, thread: BotThread) => void): Delivery {
  return store.db.transaction(() => {
    const id = `${caller.id}:${input.requestId}`
    const prior = store.delivery(id)
    if (prior) return prior
    if (caller.id === target.id && !input.worker) throw new LilBotError('thread_self', 'You cannot ask yourself.')
    const kind = input.kind ?? 'request'
    const parent = kind === 'request' ? assertNotWorker(store, caller.id, input.chatId, input.worker) : null
    const depth = parent ? parent.depth + 1 : 1
    const thread: BotThread = input.threadId
      ? store.get(input.threadId)
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
          stoppedBy: null,
          ...(input.worker ? { worker: true as const } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
          ...(input.computer ? { computer: input.computer } : {}),
          ...(input.computerName ? { computerName: input.computerName } : {}),
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(input.capabilities !== undefined ? { capabilities: [...input.capabilities] } : {})
        }
    assertNarrowedAllowed(input.capabilities, { computer: input.computer, existing: input.threadId ? thread : undefined })
    if (thread.group) throw new LilBotError('thread_forbidden', 'That is a group: use lilbot_group.')
    if (input.threadId && Boolean(thread.worker) !== Boolean(input.worker))
      throw new LilBotError('thread_forbidden', thread.worker ? 'That exchange is a worker.' : 'That exchange is not a worker.')
    if (!thread.participants.some(p => p.id === caller.id) || !thread.participants.some(p => p.id === target.id))
      throw new LilBotError('thread_forbidden', 'Only the two participants can use this thread.')
    if ((!input.threadId && depth > THREAD_LIMITS.depth) || thread.depth > THREAD_LIMITS.depth)
      throw new LilBotError('thread_depth', 'Maximum thread depth reached. Report back to whoever asked you.')
    // Pending requests reserve their answer; continuations reserve through append below.
    const pending = (store.db.query(`SELECT count(*) AS n FROM thread_deliveries WHERE threadId=? AND ${WORK} AND status!='done'`).get(thread.id) as { n: number }).n
    const reopens = kind === 'request' && (!input.threadId || pending === 0)
    if (reopens && store.open(caller.id) >= THREAD_LIMITS.openPerBot)
      throw new LilBotError('thread_limit', `You already have ${THREAD_LIMITS.openPerBot} delegations under way. Wait for answers or stop one first.`)
    if (reopens && thread.worker && store.openWorkers(caller.id) >= THREAD_LIMITS.workersPerBot)
      throw new LilBotError('thread_limit', `You already have ${THREAD_LIMITS.workersPerBot} workers under way. Wait for answers or stop one first.`)
    if (thread.state !== 'open' || thread.messages.length + pending + 2 > THREAD_LIMITS.messages)
      throw new LilBotError('thread_limit', 'Thread message limit reached. Report back to whoever asked you.')
    thread.messages.push({
      id,
      authorId: caller.id,
      authorName: caller.name,
      createdAt: Date.now(),
      items: [{ kind: 'assistant', text: input.text }],
      ...(kind === 'redirect' ? { redirect: true } : kind === 'oscar' ? { oscar: true } : {})
    })
    if (thread.status !== 'working') Object.assign(thread, { status: 'waiting', endedAt: null, failure: undefined })
    store.save(thread)
    if (!input.threadId)
      store.db.query('INSERT OR IGNORE INTO thread_links(thread_id,batch_id,parent_id) VALUES(?,?,?)').run(thread.id, input.batchId ?? null, input.parentId ?? null)
    store.db
      .query('INSERT INTO thread_deliveries(id,threadId,sender,target,sourceChat,text,kind) VALUES(?,?,?,?,?,?,?)')
      .run(id, thread.id, caller.id, target.id, input.chatId, input.text, kind)
    record?.(id, thread)
    return store.delivery(id)!
  })()
}
