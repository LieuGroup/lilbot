/** Memory setup belongs to the bot service, with stable ids on the app side of the binding. */
import { LilBotError } from '../../shared/protocol'
import type { MemoryConnection } from '../engines/bot-engine'
import type { MemoryService } from '../memory/memory-service'
import type { BotRuntimes } from './bot-runtimes'

export class BotMemory {
  constructor(
    private runtimes: BotRuntimes,
    private memory: MemoryService,
    private connection: MemoryConnection | undefined,
    private changed: () => void
  ) {}

  async list(botId: string) {
    const deleted = this.runtimes.store.deleted(botId)
    if (deleted) return { connected: false, botName: deleted.bot.name, ...this.memory.panel(botId) }
    const bot = await this.runtimes.require(botId)
    const state = this.runtimes.snapshot(bot)
    return { connected: state?.memoryConnected ?? false, botName: bot.name, ...this.memory.panel(botId) }
  }

  async connectNew(botId: string) {
    if (this.connection) await this.connect(botId, { keepOwnNotes: false })
  }

  async connect(botId: string, options = { keepOwnNotes: true }): Promise<{ imported: number }> {
    if (!this.connection) throw new LilBotError('memory_unavailable', 'Memory is not set up on this LilBot server.')
    const bot = await this.runtimes.require(botId)
    const notes = await this.runtimes.engineFor(bot).connectMemory(bot.engineBotId, { ...this.connection, botId })
    this.runtimes.memoryConnected(botId)
    const before = this.memory.list(botId).length
    for (const text of notes.aboutUser) this.importNote(botId, 'shared', text)
    for (const text of options.keepOwnNotes ? notes.ownNotes : []) this.importNote(botId, 'bot', text)
    this.changed()
    return { imported: this.memory.list(botId).length - before }
  }

  async connectAll(): Promise<string[]> {
    if (!this.connection) return []
    await this.runtimes.initialize()
    const connected: string[] = []
    for (const bot of this.runtimes.store.list()) {
      const state = this.runtimes.snapshot(bot)
      if (!state || state.memoryConnected) continue
      await this.connect(bot.id)
      connected.push(bot.id)
    }
    return connected
  }

  private importNote(botId: string, scope: 'bot' | 'shared', text: string) {
    try {
      this.memory.write({ botId, kind: 'profile', scope, text: text.slice(0, 500), author: 'bot', via: 'import' })
    } catch (error) {
      if (!(error instanceof LilBotError)) throw error
      console.error(`[memory] skipped a note while connecting ${botId}: ${error.code}`)
    }
  }
}
