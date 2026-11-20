/** Handing work to other bots from LilBot's MCP server: several tasks at once, with files, and control over them
 *  (status, stop, redirect, wait) for the bot that handed them out. Built on the same exchanges as `ask_bot`. */
import { LilBotError } from '../../shared/protocol'
import { AttachInput, type BotThread, DelegateInput, RedirectInput } from '../../shared/thread-schema'
import { memoryRefusal } from '../memory/memory-safety'
import { type CopiedFile, checkFiles, copyFile, removeCopy } from './exchange-files'
import { THREAD_LIMITS } from './thread-limits'
import { steerText } from './thread-prompts'
import type { ThreadHost, ThreadService } from './thread-service'
import { FINAL } from './thread-store'

export interface DelegationHost extends ThreadHost {
  folder(botId: string): Promise<string>
  steerRun?(botId: string, chatId: string, text: string): Promise<'steered' | 'not_running'>
}
type Pick = { exchangeIds?: string[]; batchId?: string }
const unsafe = (text: string) => {
  const refusal = memoryRefusal(text)
  if (refusal) throw new LilBotError('unsafe_message', refusal.replace('not saved', 'not sent'))
}

export class DelegationService {
  constructor(
    private threads: ThreadService,
    private host: DelegationHost,
    /** The caller's conversation that made this call, where answers return. */
    private callingChat: (botId: string, requestId: string) => Promise<string | null>
  ) {}
  private get store() {
    return this.threads.store
  }

  async delegate(callerId: string, raw: DelegateInput) {
    const input = DelegateInput.parse(raw)
    const caller = await this.host.requireBot(callerId)
    const ids = input.tasks.map((_, i) => `${input.requestId}:${i}`)
    const fresh = input.tasks.filter((_, i) => !this.store.delivery(`${callerId}:${ids[i]}`))
    const chatId = fresh.length ? await this.callingChat(callerId, input.requestId) : null
    if (fresh.length && !chatId) throw new LilBotError('no_conversation', 'LilBot could not tell which conversation this came from. Try again from a conversation.')
    // Everything is checked before any task is handed out, so a refusal hands out nothing.
    const targets = await Promise.all(
      input.tasks.map(t =>
        t.exchangeId
          ? this.other(t.exchangeId, callerId)
          : t.to
            ? this.threads.target(t.to)
            : Promise.reject(new LilBotError('thread_target', 'Give each task a bot (to) or an exchangeId.'))
      )
    )
    if (new Set(targets.map(t => t.id)).size !== targets.length) throw new LilBotError('thread_target', 'One task per bot in a call.')
    if (targets.some(t => t.id === callerId)) throw new LilBotError('thread_self', 'You cannot hand work to yourself.')
    for (const t of input.tasks) unsafe(t.task)
    const opening = fresh.filter(t => !t.exchangeId).length
    if (this.store.open(callerId) + opening > THREAD_LIMITS.openPerBot)
      throw new LilBotError(
        'thread_limit',
        `At most ${THREAD_LIMITS.openPerBot} delegations can be under way at once; ${this.store.open(callerId)} are. Wait for answers or stop one.`
      )
    const root = await this.host.folder(callerId)
    for (const t of fresh) await checkFiles(root, t.files ?? [])
    const batchId = crypto.randomUUID()
    const exchanges = []
    for (const [i, task] of input.tasks.entries()) {
      const prior = this.store.delivery(`${callerId}:${ids[i]}`)
      const delivery = prior ?? (await this.hand(caller, targets[i], { ...task, requestId: ids[i], chatId: chatId!, batchId, root }))
      const thread = this.store.get(delivery.threadId)
      exchanges.push({ exchangeId: thread.id, to: targets[i].name, status: thread.status, batchId: thread.batchId })
    }
    if (fresh.length) this.threads.changed()
    return { exchanges, note: 'Each answer arrives later as a new turn in this conversation. Do not poll; use lilbot_delegation_wait to hear when all are in.' }
  }

  private async hand(
    caller: { id: string; name: string },
    target: { id: string; name: string },
    t: { requestId: string; task: string; files?: string[]; exchangeId?: string; chatId: string; batchId: string; root: string }
  ) {
    const newId = t.exchangeId ?? crypto.randomUUID()
    const toRoot = await this.host.folder(target.id)
    const copies: CopiedFile[] = []
    let recorded = false
    try {
      for (const file of t.files ?? []) copies.push(await copyFile(t.root, file, toRoot, newId))
      return this.store.accept(
        caller,
        target,
        { requestId: t.requestId, text: t.task, chatId: t.chatId, threadId: t.exchangeId, newId, batchId: t.batchId },
        (messageId, thread) => {
          recorded = true
          for (const [n, c] of copies.entries())
            this.threads.files.add({
              id: `${messageId}:${n}`,
              thread_id: thread.id,
              message_id: messageId,
              sender: caller.id,
              name: c.name,
              size: c.size,
              sha256: c.sha256,
              source: c.source,
              copy: c.copy
            })
        }
      )
    } finally {
      if (!recorded) for (const c of copies) await removeCopy(toRoot, c.copy).catch(() => {})
    }
  }

  /** The other participant of an exchange this bot takes part in. */
  private async other(exchangeId: string, botId: string) {
    const thread = this.store.get(exchangeId)
    const other = thread.participants.find(p => p.id !== botId)
    if (!other || !thread.participants.some(p => p.id === botId)) throw new LilBotError('thread_forbidden', 'You are not part of that exchange.')
    return this.host.requireBot(other.id)
  }

  /** Exchanges this bot handed out: by id, by batch, or else those under way and the latest few. */
  private mine(botId: string, pick: Pick): BotThread[] {
    const ids = pick.exchangeIds ?? (pick.batchId ? this.store.batch(pick.batchId) : null)
    const threads = ids
      ? ids.map(id => this.store.get(id))
      : this.store
          .list(botId)
          .filter(t => t.participants[0].id === botId)
          .filter((t, i) => !(FINAL as readonly string[]).includes(t.status) || i < 10)
    if (threads.some(t => t.participants[0].id !== botId)) throw new LilBotError('thread_forbidden', 'Only the bot that handed over this work can do that.')
    return threads
  }

  async status(botId: string, pick: Pick) {
    await this.host.requireBot(botId)
    return { exchanges: this.mine(botId, pick).map(t => this.summary(t)) }
  }

  private summary(stored: BotThread) {
    const t = this.threads.view(stored)
    const answer = t.messages.filter(m => m.authorId !== t.participants[0].id && !m.withheld).at(-1)
    const text = answer?.items.flatMap(i => (i.kind === 'assistant' ? [i.text] : [])).join('\n\n')
    return {
      exchangeId: t.id,
      batchId: t.batchId,
      to: t.participants[1].name,
      status: t.status,
      activity: t.activity,
      runSeconds: t.startedAt ? Math.round(((t.endedAt ?? Date.now()) - t.startedAt) / 1000) : null,
      stoppedBy: t.stoppedBy?.name ?? null,
      files: t.messages.flatMap(m => m.files ?? []),
      ...(text ? { lastAnswer: text.slice(0, 2000) } : {})
    }
  }

  cancel(botId: string, exchangeId: string) {
    return this.host
      .requireBot(botId)
      .then(bot => this.threads.cancel(exchangeId, { kind: 'bot', id: bot.id, name: bot.name }))
      .then(t => this.summary(t))
  }

  /** A change of course: into the running turn at its next step when the engine can steer, else the receiver's next turn. */
  async redirect(botId: string, raw: { requestId: string; exchangeId: string; message: string }) {
    const input = RedirectInput.parse(raw)
    const caller = await this.host.requireBot(botId)
    const [thread] = this.mine(botId, { exchangeIds: [input.exchangeId] })
    const prior = this.store.delivery(`${botId}:${input.requestId}`)
    if (prior) return { exchangeId: thread.id, applied: prior.status === 'steered' ? 'now' : 'queued' }
    if (thread.status !== 'waiting' && thread.status !== 'working')
      throw new LilBotError('not_running', 'That exchange is not under way. Continue it with lilbot_delegate and its exchangeId.')
    unsafe(input.message)
    const receiver = thread.participants[1]
    const origin = this.store.origin(thread.id, receiver.id)
    const running = this.threads.runner.runningFor(thread.id)
    const d = this.store.accept(caller, await this.host.requireBot(receiver.id), {
      requestId: input.requestId,
      text: input.message,
      chatId: origin?.sourceChat ?? '',
      threadId: thread.id,
      kind: 'redirect'
    })
    this.threads.changed()
    if (!running?.chatId || !this.host.steerRun) return { exchangeId: thread.id, applied: thread.status === 'waiting' ? 'with the task' : 'next turn' }
    this.store.setStatus(d.id, 'steered')
    const steered = await this.host.steerRun(receiver.id, running.chatId, steerText(caller.name, thread.id, d.id, input.message)).catch(() => 'not_running' as const)
    if (steered !== 'steered') this.store.setStatus(d.id, 'pending')
    return { exchangeId: thread.id, applied: steered === 'steered' ? 'now' : 'next turn' }
  }

  /** Never holds the call open: each answer still arrives on its own, and the bot is told once all are in. */
  async wait(botId: string, pick: Pick) {
    await this.host.requireBot(botId)
    const threads = this.mine(botId, pick)
    if (!threads.length) throw new LilBotError('thread_missing', 'Name the exchanges or the batch to wait for.')
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

  /** The receiver's files for its answer: checked now, copied to the other bot when the answer goes out. */
  async attach(botId: string, raw: { exchangeId: string; files: string[] }) {
    const input = AttachInput.parse(raw)
    await this.host.requireBot(botId)
    const running = this.threads.runner.runningFor(input.exchangeId)
    if (!running || running.target !== botId) throw new LilBotError('not_running', 'Attach files while you work on that exchange; they go back with your answer.')
    const messageId = `${running.id}:reply`
    const staged = this.threads.files.forMessage(messageId)
    const checked = await checkFiles(await this.host.folder(botId), input.files, staged.length)
    for (const [n, f] of checked.entries())
      this.threads.files.add({
        id: `${messageId}:${staged.length + n}`,
        thread_id: input.exchangeId,
        message_id: messageId,
        sender: botId,
        name: f.name,
        size: f.size,
        sha256: null,
        source: f.source,
        copy: null
      })
    return { exchangeId: input.exchangeId, files: [...staged.map(f => f.name), ...checked.map(f => f.name)], note: 'They are copied to the other bot with your answer.' }
  }
}
