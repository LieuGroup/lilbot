/** Memory setup belongs to the bot service, with stable ids on the app side of the binding. */
import { LilBotError } from '../../shared/lilbot-error'
import type { MemoryBrowseInput, MemoryBrowsePage } from '../../shared/memory-schema'
import { backgroundFailure } from '../background'
import type { MemoryConnection } from '../engines/bot-engine'
import type { MemoryService } from '../memory/memory-service'
import type { BotRuntimes } from './bot-runtimes'

export class BotMemory {
  constructor(
    private runtimes: BotRuntimes,
    private memory: MemoryService,
    private connectionFor: ((botId: string) => MemoryConnection) | undefined,
    private changed: () => void
  ) {}

  async list(botId: string) {
    const deleted = this.runtimes.store.deleted(botId)
    if (deleted) return { connected: false, botName: deleted.bot.name, ...this.memory.panel(botId) }
    const bot = await this.runtimes.require(botId)
    const state = this.runtimes.snapshot(bot)
    return { connected: state?.memoryConnected ?? false, botName: bot.name, ...this.memory.panel(botId) }
  }

  /** The app-wide Memory page: one page of facts, with every bot it names (deleted bots keep their name). */
  browse(input: MemoryBrowseInput): MemoryBrowsePage {
    const { bots: owners, ...page } = this.memory.browse(input)
    const live = this.runtimes.store.list()
    const own = new Map(owners.map(owner => [owner.botId, owner.facts]))
    const named = new Set([...own.keys(), ...page.facts.map(fact => fact.botId)])
    const bots = [...named].map(botId => {
      const bot = live.find(candidate => candidate.id === botId)
      const name = bot?.name ?? this.runtimes.store.deleted(botId)?.bot.name ?? 'A removed bot'
      return { botId, name, deleted: !bot, facts: own.get(botId) ?? 0 }
    })
    const notConnected = this.connectionFor ? live.filter(bot => this.runtimes.snapshot(bot)?.memoryConnected === false).map(bot => ({ botId: bot.id, name: bot.name })) : []
    return { ...page, bots, notConnected }
  }

  async connectNew(botId: string) {
    if (this.connectionFor) await this.connect(botId, { keepOwnNotes: false })
  }

  async connect(botId: string, options = { keepOwnNotes: true }): Promise<{ imported: number }> {
    if (!this.connectionFor) throw new LilBotError('memory_unavailable', 'Memory is not set up on this LilBot server.')
    const bot = await this.runtimes.require(botId)
    const notes = await this.runtimes.engineFor(bot).connectMemory(bot.engineBotId, { ...this.connectionFor(botId), botId })
    this.runtimes.memoryConnected(botId)
    const before = this.memory.list(botId).length
    for (const text of notes.aboutUser) this.importNote(botId, 'shared', text)
    for (const text of options.keepOwnNotes ? notes.ownNotes : []) this.importNote(botId, 'bot', text)
    this.changed()
    return { imported: this.memory.list(botId).length - before }
  }

  async connectAll(onFailed?: (botId: string) => void): Promise<string[]> {
    if (!this.connectionFor) return []
    await this.runtimes.initialize()
    const connected: string[] = []
    for (const bot of this.runtimes.store.list()) {
      const state = this.runtimes.snapshot(bot)
      if (!state || state.memoryConnected) continue
      try {
        await this.connect(bot.id)
        connected.push(bot.id)
      } catch {
        backgroundFailure('memory connection')
        onFailed?.(bot.id)
      }
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
