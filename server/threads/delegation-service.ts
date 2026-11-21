/** Handing work to other bots from LilBot's MCP server: one task per bot, several at once, with files both ways.
 *  Built on the same exchanges as `ThreadService.ask`; control over them is `delegation-control.ts`. */
import { LilBotError } from '../../shared/lilbot-error'
import { AttachInput, DelegateInput } from '../../shared/thread-schema'
import { refuseUnsafe } from '../memory/memory-safety'
import { checkFiles, stageFiles, withCopies } from './exchange-files'
import { THREAD_LIMITS } from './thread-limits'
import type { ThreadHost, ThreadService } from './thread-service'

export interface DelegationHost extends ThreadHost {
  folder(botId: string): Promise<string>
  steerRun?(botId: string, chatId: string, text: string): Promise<'steered' | 'not_running'>
}
type Bot = { id: string; name: string }
/** The work board (#141), so work handed out inside an item hangs under it as the receiver's own item. */
export interface DelegationWork {
  /** The caller's item this delegation from `chatId` belongs to, or null; refuses an item that is not the caller's. */
  parentFor(callerId: string, chatId: string, itemId?: string): string | null
  /** Runs inside the new exchange's transaction. */
  child(parentId: string, exchange: { id: string; owner: Bot; asker: Bot; task: string }): void
}

export class DelegationService {
  constructor(
    private threads: ThreadService,
    private host: DelegationHost,
    /** The caller's conversation that made this call, where answers return; refuses when that cannot be known. */
    private callingChat: (botId: string, requestId: string) => Promise<string>,
    private work?: DelegationWork
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
    for (const t of input.tasks) refuseUnsafe(t.task)
    const opening = fresh.filter(t => !t.exchangeId).length
    if (this.store.open(callerId) + opening > THREAD_LIMITS.openPerBot)
      throw new LilBotError(
        'thread_limit',
        `At most ${THREAD_LIMITS.openPerBot} delegations can be under way at once; ${this.store.open(callerId)} are. Wait for answers or stop one.`
      )
    const root = await this.host.folder(callerId)
    for (const t of fresh) await checkFiles(root, t.files ?? [])
    const parentId = chatId ? (this.work?.parentFor(callerId, chatId, input.itemId) ?? null) : null
    const batchId = crypto.randomUUID()
    const exchanges = []
    for (const [i, task] of input.tasks.entries()) {
      const prior = this.store.delivery(`${callerId}:${ids[i]}`)
      const delivery = prior ?? (await this.hand(caller, targets[i], { ...task, requestId: ids[i], chatId: chatId!, batchId, parentId, root }))
      const thread = this.store.get(delivery.threadId)
      exchanges.push({ exchangeId: thread.id, to: targets[i].name, status: thread.status, batchId: thread.batchId })
    }
    if (fresh.length) this.threads.changed()
    return {
      exchanges,
      ...(parentId ? { itemId: parentId } : {}),
      note: 'Each answer arrives later as a new turn in this conversation. Do not poll; use lilbot_delegation (action wait) to hear when all are in.'
    }
  }

  private async hand(
    caller: { id: string; name: string },
    target: { id: string; name: string },
    t: { requestId: string; task: string; files?: string[]; exchangeId?: string; chatId: string; batchId: string; parentId: string | null; root: string }
  ) {
    const newId = t.exchangeId ?? crypto.randomUUID()
    const toRoot = await this.host.folder(target.id)
    return withCopies(t.root, t.files ?? [], toRoot, ['exchanges', newId], (copies, keep) =>
      this.store.accept(
        caller,
        target,
        { requestId: t.requestId, text: t.task, chatId: t.chatId, threadId: t.exchangeId, newId, batchId: t.batchId, parentId: t.exchangeId ? null : t.parentId },
        (messageId, thread) => {
          keep()
          if (!t.exchangeId && t.parentId) this.work?.child(t.parentId, { id: thread.id, owner: target, asker: caller, task: t.task })
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
    )
  }

  /** The other participant of an exchange this bot takes part in. */
  private async other(exchangeId: string, botId: string) {
    const thread = this.store.get(exchangeId)
    const other = thread.participants.find(p => p.id !== botId)
    if (!other || !thread.participants.some(p => p.id === botId)) throw new LilBotError('thread_forbidden', 'You are not part of that exchange.')
    return this.host.requireBot(other.id)
  }

  /** The receiver's files for its answer: checked now, copied to the other bot when the answer goes out. */
  async attach(botId: string, raw: { exchangeId: string; files: string[] }) {
    const input = AttachInput.parse(raw)
    await this.host.requireBot(botId)
    if (this.store.get(input.exchangeId).group) throw new LilBotError('thread_forbidden', 'That is a group: attach with lilbot_group.')
    const running = this.threads.runner.runningFor(input.exchangeId)
    if (!running || running.target !== botId) throw new LilBotError('not_running', 'Attach files while you work on that exchange; they go back with your answer.')
    const at = { threadId: input.exchangeId, messageId: `${running.id}:reply`, sender: botId }
    const files = await stageFiles(this.threads.files, await this.host.folder(botId), at, input.files)
    return { exchangeId: input.exchangeId, files, note: 'They are copied to the other bot with your answer.' }
  }
}
