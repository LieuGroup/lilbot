/** The delegating bot's control over work it handed out: status, stop, redirect and wait. Stopping is the same
 *  `ThreadService.cancel` Oscar's `threads.cancel` uses, recorded as stopped by the bot. */
import { LilBotError } from '../../shared/lilbot-error'
import { type BotThread, RedirectInput } from '../../shared/thread-schema'
import { memoryRefusal, refuseUnsafe } from '../memory/memory-safety'
import type { DelegationHost } from './delegation-service'
import { assertNarrowedAllowed, withinNarrowed } from './thread-accept'
import { steerText } from './thread-prompts'
import type { ThreadService } from './thread-service'
import { FINAL } from './thread-store'

type Pick = { exchangeIds?: string[]; batchId?: string }

export class DelegationControl {
  constructor(
    private threads: ThreadService,
    private host: DelegationHost
  ) {}
  private get store() {
    return this.threads.store
  }

  /** Exchanges this bot handed out: by id, by batch, or else those under way and the latest few. */
  private mine(botId: string, pick: Pick): BotThread[] {
    const ids = pick.exchangeIds ?? (pick.batchId ? this.store.batch(pick.batchId) : null)
    const threads = ids
      ? ids.map(id => this.store.get(id))
      : this.store
          .list(botId)
          .filter(t => t.participants[0].id === botId && !t.group)
          .filter((t, i) => !(FINAL as readonly string[]).includes(t.status) || i < 10)
    if (threads.some(t => t.group)) throw new LilBotError('thread_forbidden', 'That is a group: use lilbot_group.')
    if (threads.some(t => t.participants[0].id !== botId)) throw new LilBotError('thread_forbidden', 'Only the bot that handed over this work can do that.')
    return threads
  }

  private callerCapabilities(botId: string, raw: unknown) {
    return this.host.callerCapabilities?.(botId, 'lilbot_delegation', raw) ?? Promise.resolve(null)
  }

  async status(botId: string, pick: Pick, callArgs?: unknown) {
    await this.host.requireBot(botId)
    const caps = await this.callerCapabilities(botId, callArgs ?? { action: 'status', ...pick })
    const threads = this.mine(botId, pick)
    if (caps) {
      if (pick.exchangeIds || pick.batchId) for (const t of threads) assertNarrowedAllowed(caps, { existing: t })
      else return { exchanges: threads.filter(t => withinNarrowed(caps, t)).map(t => this.summary(t)) }
    }
    return { exchanges: threads.map(t => this.summary(t)) }
  }

  private summary(stored: BotThread) {
    const t = this.threads.view(stored)
    const answer = t.messages.filter(m => (t.worker ? m.fromWorker === true : m.authorId !== t.participants[0].id) && !m.withheld).at(-1)
    const raw = answer?.items.flatMap(i => (i.kind === 'assistant' ? [i.text] : [])).join('\n\n')
    const text = t.status !== 'failed' && raw && !memoryRefusal(raw) ? raw : undefined
    return {
      exchangeId: t.id,
      batchId: t.batchId,
      to: t.worker ? 'worker' : t.participants[1].name,
      ...(t.worker ? { worker: true as const } : {}),
      ...(t.computer ? { computer: t.computerName ?? t.computer } : {}),
      status: t.status,
      activity: t.activity,
      runSeconds: t.startedAt ? Math.round(((t.endedAt ?? Date.now()) - t.startedAt) / 1000) : null,
      stoppedBy: t.stoppedBy?.name ?? null,
      files: t.messages.flatMap(m => m.files ?? []),
      ...(text ? { lastAnswer: text.slice(0, 2000) } : {})
    }
  }

  async cancel(botId: string, exchangeId: string, callArgs?: unknown) {
    const bot = await this.host.requireBot(botId)
    const [thread] = this.mine(botId, { exchangeIds: [exchangeId] })
    assertNarrowedAllowed(await this.callerCapabilities(botId, callArgs ?? { action: 'cancel', exchangeId }), { existing: thread })
    return this.summary(await this.threads.cancel(exchangeId, { kind: 'bot', id: bot.id, name: bot.name }))
  }

  /** A change of course: into the running turn at its next step when the engine can steer, else the receiver's next turn. */
  async redirect(botId: string, raw: { requestId: string; exchangeId: string; message: string }, callArgs?: unknown) {
    const input = RedirectInput.parse(raw)
    const caller = await this.host.requireBot(botId)
    const [thread] = this.mine(botId, { exchangeIds: [input.exchangeId] })
    assertNarrowedAllowed(await this.callerCapabilities(botId, callArgs ?? { action: 'redirect', ...raw }), { existing: thread })
    const prior = this.store.delivery(`${botId}:${input.requestId}`)
    if (prior) return { exchangeId: thread.id, applied: prior.status === 'steered' ? 'now' : 'queued' }
    if (thread.status !== 'waiting' && thread.status !== 'working')
      throw new LilBotError('not_running', 'That exchange is not under way. Continue it with lilbot_delegate and its exchangeId.')
    refuseUnsafe(input.message)
    const receiver = thread.participants[1]
    const origin = this.store.origin(thread.id, receiver.id)
    const running = this.threads.runner.runningFor(thread.id)
    const d = this.store.accept(caller, await this.host.requireBot(receiver.id), {
      requestId: input.requestId,
      text: input.message,
      chatId: origin?.sourceChat ?? '',
      threadId: thread.id,
      kind: 'redirect',
      worker: thread.worker
    })
    this.threads.changed()
    if (!running?.chatId || !this.host.steerRun) return { exchangeId: thread.id, applied: thread.status === 'waiting' ? 'with the task' : 'next turn' }
    this.threads.runner.steering.add(d.id)
    try {
      this.store.setStatus(d.id, 'steered')
      const steered = await this.host
        .steerRun(receiver.id, running.chatId, steerText(caller.name, thread.id, d.id, input.message, thread.worker))
        .catch(() => 'not_running' as const)
      if (steered !== 'steered') this.store.setStatus(d.id, 'pending')
      return { exchangeId: thread.id, applied: steered === 'steered' ? 'now' : 'next turn' }
    } finally {
      this.threads.runner.steering.delete(d.id)
    }
  }

  /** Never holds the call open: each answer still arrives on its own, and the bot is told once all are in. */
  async wait(botId: string, pick: Pick, callArgs?: unknown) {
    await this.host.requireBot(botId)
    const caps = await this.callerCapabilities(botId, callArgs ?? { action: 'wait', ...pick })
    const threads = this.mine(botId, pick)
    if (!threads.length) throw new LilBotError('thread_missing', 'Name the exchanges or the batch to wait for.')
    for (const t of threads) assertNarrowedAllowed(caps, { existing: t })
    const exchanges = threads.map(t => this.summary(t))
    if (threads.every(t => (FINAL as readonly string[]).includes(t.status))) return { allIn: true, exchanges }
    const origin = this.store.origin(threads[0].id, threads[0].participants[1].id)
    if (origin)
      this.threads.waits.add(
        botId,
        origin.sourceChat,
        threads.map(t => t.id)
      )
    return { allIn: false, exchanges, note: 'LilBot tells you in this conversation once all are in. Do not poll.' }
  }
}
