import type { BotDeleteInput } from '../../shared/bot-delete-schema'
import { LilBotError } from '../../shared/protocol'
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

  private async run(input: BotDeleteInput): Promise<{ ok: true }> {
    await this.runtimes.load()
    const store = this.runtimes.store
    const tombstone = store.deleted(input.botId)
    if (tombstone?.complete) return { ok: true }
    const bot = tombstone?.bot ?? store.get(input.botId)
    if (bot.isDefault) throw new LilBotError('protected_bot', 'The engine’s default bot cannot be deleted.')
    if (this.prefs.primaryBot() === bot.id) throw new LilBotError('primary_bot', 'Choose another primary bot before deleting this one.')
    const engine = this.runtimes.engineFor(bot)
    const defaults = store.deleteDefaults()
    const choices = tombstone?.choices ?? { files: input.files ?? defaults.files, privateMemories: input.privateMemories ?? defaults.privateMemories }
    store.markDeleted(bot, choices)
    try {
      await this.runtimes.release(bot.id)
      try {
        await engine.deleteRuntime(bot.engineBotId)
      } catch (error) {
        if (!(error instanceof LilBotError && error.code === 'bot_not_found')) throw error
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
