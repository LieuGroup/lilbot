import type { BotDeleteInput } from '../../shared/bot-delete-schema'
import { LilBotError } from '../../shared/lilbot-error'
import type { MemoryService } from '../memory/memory-service'
import type { BotPrefsStore } from './bot-prefs-store'
import type { BotRuntimes } from './bot-runtimes'
import type { Workspaces } from './workspaces'

/** Durable choices and tombstones make each step repeatable after process or engine failure. */
export class BotDeletion {
  private pending = new Map<string, Promise<{ ok: true }>>()
  constructor(
    private runtimes: BotRuntimes,
    private prefs: BotPrefsStore,
    private workspaces: Workspaces,
    private memory: MemoryService,
    private cleanup: (botId: string) => void,
    private changed: () => void
  ) {}

  delete(input: BotDeleteInput): Promise<{ ok: true }> {
    const prior = this.pending.get(input.botId)
    if (prior) return prior
    const task = this.run(input).finally(() => this.pending.delete(input.botId))
    this.pending.set(input.botId, task)
    return task
  }

  /** Retries tombstones left incomplete by an earlier transient engine failure; never throws. */
  async resumeIncomplete(): Promise<void> {
    for (const botId of this.runtimes.store.incompleteDeletions()) {
      await this.delete({ botId }).catch(() => {})
    }
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
    } finally {
      this.changed()
    }
  }
}
