import type { BotDeleteInput } from '../../shared/bot-delete-schema'
import { LilBotError } from '../../shared/lilbot-error'
import { backgroundTask, RetryQueue } from '../background'
import type { MemoryService } from '../memory/memory-service'
import type { BotPrefsStore } from './bot-prefs-store'
import type { BotRuntimes } from './bot-runtimes'
import type { Workspaces } from './workspaces'

const MAX_CONCURRENT_RETRIES = 2
const DEFAULT_RETRY_DELAY_MS = 30_000

export interface BotDeletionOptions {
  now?: () => number
  retryDelayMs?: number
}

/** Durable choices and tombstones make each step repeatable after process or engine failure. */
export class BotDeletion {
  private pending = new Map<string, Promise<{ ok: true }>>()
  private retries: RetryQueue
  private retryTimer?: ReturnType<typeof setTimeout>
  private autoRetry = false
  private retryDelayMs: number
  constructor(
    private runtimes: BotRuntimes,
    private prefs: BotPrefsStore,
    private workspaces: Workspaces,
    private memory: MemoryService,
    private cleanup: (botId: string) => void,
    private changed: () => void,
    options: BotDeletionOptions = {}
  ) {
    this.retryDelayMs = Math.max(1, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS)
    this.retries = new RetryQueue('bot deletion', options.now ?? Date.now, this.retryDelayMs)
  }

  delete(input: BotDeleteInput): Promise<{ ok: true }> {
    const prior = this.pending.get(input.botId)
    if (prior) return prior
    const task = this.run(input)
    const clear = () => void this.pending.delete(input.botId)
    task.then(clear, clear)
    this.pending.set(input.botId, task)
    return task
  }

  /** Starts bounded background retries for confirmed incomplete tombstones without blocking start-up.
   *  Leaves no timer running when there are no incomplete tombstones. */
  resumeIncomplete(): () => void {
    this.autoRetry = true
    this.tickIncomplete()
    return () => this.stopRetries()
  }

  stopRetries() {
    this.autoRetry = false
    clearTimeout(this.retryTimer)
    this.retryTimer = undefined
  }

  tickIncomplete(): string[] {
    const ids = this.runtimes.store.incompleteDeletions()
    if (!ids.length) {
      clearTimeout(this.retryTimer)
      this.retryTimer = undefined
      return []
    }
    const started: string[] = []
    for (const botId of ids) {
      if (this.retries.running.size >= MAX_CONCURRENT_RETRIES) break
      if (!this.retries.ready(botId) || this.pending.has(botId)) continue
      started.push(botId)
      this.retries.run(botId, () => this.resumeOne(botId), {
        onError: error => error instanceof LilBotError && error.code === 'bot_not_found',
        onFinally: () => {
          if (this.autoRetry) this.tickIncomplete()
        }
      })
    }
    this.scheduleNextRetry()
    return started
  }

  private async resumeOne(botId: string): Promise<void> {
    const tombstone = this.runtimes.store.deleted(botId)
    if (!tombstone || tombstone.complete) return
    await this.delete({ botId })
  }

  private scheduleNextRetry() {
    if (!this.autoRetry || this.retryTimer) return
    if (!this.runtimes.store.incompleteDeletions().length) return
    const waitMs = this.retryDelayMs + Math.min(50, Math.max(5, Math.ceil(this.retryDelayMs / 10)))
    this.retryTimer = setTimeout(
      backgroundTask('bot deletion', () => {
        this.retryTimer = undefined
        this.tickIncomplete()
      }),
      waitMs
    )
    this.retryTimer.unref?.()
  }

  private async run(input: BotDeleteInput): Promise<{ ok: true }> {
    await this.runtimes.load()
    const store = this.runtimes.store
    const tombstone = store.deleted(input.botId)
    if (tombstone?.complete) return { ok: true }
    const bot = tombstone?.bot ?? store.get(input.botId)
    const bots = store.list()
    const primaryId = bots.find(b => b.id === this.prefs.primaryBot())?.id ?? bots.find(b => b.isDefault)?.id
    if (primaryId === bot.id) throw new LilBotError('primary_bot', 'Choose another primary bot before deleting this one.')
    const engine = this.runtimes.engineIfAvailable(bot)
    const defaults = store.deleteDefaults()
    const choices = tombstone?.choices ?? { files: input.files ?? defaults.files, privateMemories: input.privateMemories ?? defaults.privateMemories }
    store.markDeleted(bot, choices)
    try {
      await this.runtimes.release(bot.id)
      if (engine) {
        try {
          await engine.deleteRuntime(bot.engineBotId)
        } catch (error) {
          if (!(error instanceof LilBotError && (error.code === 'bot_not_found' || error.code === 'protected_bot'))) throw error
        }
      }
      if (choices.privateMemories === 'forget') this.memory.forgetPrivate(bot.id)
      await this.workspaces.remove(bot.id, choices.files)
      this.prefs.forgetBot(bot.id)
      this.cleanup(bot.id)
      store.markDeleted(bot, choices, true)
      return { ok: true }
    } catch (error) {
      this.retries.retry(bot.id)
      this.scheduleNextRetry()
      throw error
    } finally {
      this.changed()
    }
  }
}
