import type { ChatEvent, ChatSnapshot } from '../../shared/chat-schema'
import type { SessionReason } from '../../shared/history-schema'
import type { BotEngine, ConversationSource } from '../engines/bot-engine'
import { asEngineRegistry, type EngineRegistry } from '../engines/engine-registry'
import type { HistoryStore } from './history-store'

type Binding = { id: string; engineId?: string; engineBotId: string }
/** A bounded background page per tick. Checkpoints commit atomically with their rows. */
export class HistoryService {
  private engines: EngineRegistry
  private sources = new Map<string, { engineId: string; source: ConversationSource; listed: number; turn: number }>()
  private connecting = new Map<string, Promise<ConversationSource>>()
  private busy = false
  private dirty = new Map<string, Set<string>>()
  constructor(
    readonly store: HistoryStore,
    engine: BotEngine | EngineRegistry,
    private bindings: () => Promise<Binding[]>,
    private allowed: (bot: string, session: string) => boolean,
    private project: (bot: string, session: string, rows: import('./history-store').HistoryRow[]) => import('./history-store').HistoryRow[] = (_b, _s, rows) => rows,
    private changed: (bot: string) => void = () => {}
  ) {
    this.engines = asEngineRegistry(engine)
  }
  dropSource(botId: string) {
    this.sources.get(botId)?.source.close()
    this.sources.delete(botId)
  }
  async source(bot: Binding) {
    const engineId = bot.engineId ?? this.engines.defaultId
    let value = this.sources.get(bot.id)
    if (value && value.engineId !== engineId) {
      this.dropSource(bot.id)
      value = undefined
    }
    if (!value) {
      const engine = this.engines.get(engineId)
      if (!engine?.conversations) return undefined
      let attempt = this.connecting.get(bot.id)
      if (!attempt) {
        attempt = engine.conversations(bot.engineBotId)
        this.connecting.set(bot.id, attempt)
      }
      try {
        value = { engineId, source: await attempt, listed: 0, turn: 0 }
      } finally {
        this.connecting.delete(bot.id)
      }
      this.sources.set(bot.id, value)
    }
    return value
  }
  async tick() {
    if (this.busy) return
    this.busy = true
    try {
      const bots = await this.bindings()
      for (const [id, value] of this.sources)
        if (!bots.some(b => b.id === id)) {
          value.source.close()
          this.sources.delete(id)
        }
      for (const bot of bots) {
        try {
          const value = await this.source(bot)
          if (!value) continue
          if (Date.now() - value.listed > 30_000) {
            const listed = await value.source.list()
            if (!this.allowed(bot.id, '')) continue
            for (const session of listed) if (this.allowed(bot.id, session.id)) this.store.session(bot.id, session.id, session.at)
            this.store.discovered(bot.id)
            value.listed = Date.now()
          }
          const sessions = this.store.sessions(bot.id)
          for (const session of sessions.slice(1)) this.store.divider(bot.id, session.id, session.at)
          // Discovery may insert an earlier session after an app open.
          if (sessions[0]) this.store.db.query('DELETE FROM history_items WHERE bot=? AND id=?').run(bot.id, `session:${sessions[0].id}`)
          const dirty = this.dirty.get(bot.id)
          const changed = [...(dirty ?? [])].find(id => sessions.some(s => s.id === id))
          const session = sessions.find(s => s.id === changed) ?? sessions.find(s => !s.complete) ?? sessions[value.turn++ % sessions.length]
          if (!session || !this.allowed(bot.id, session.id)) continue
          const page = await value.source.read(session.id, session.cursor)
          if (!this.allowed(bot.id, session.id)) continue
          // New turns after a finished import are catching up, not a new import: the start marker must stay.
          this.store.write(bot.id, session.id, this.project(bot.id, session.id, page.rows), page.cursor, page.empty || !!session.complete)
          if (page.rows.length || !session.complete) this.changed(bot.id)
          if (page.empty) dirty?.delete(session.id)
        } catch {
          this.sources.get(bot.id)?.source.close()
          this.sources.delete(bot.id)
          console.error('[history] import pending; will retry')
        }
      }
    } finally {
      this.busy = false
    }
  }
  async latest(bot: Binding, snapshot: ChatSnapshot, reason?: SessionReason) {
    const source = await this.source(bot)
    if (!source || !this.allowed(bot.id, snapshot.chatId)) return
    this.store.session(bot.id, snapshot.chatId, Date.now())
    const sessions = this.store.sessions(bot.id)
    for (const session of sessions.slice(1)) this.store.divider(bot.id, session.id, session.at, session.id === snapshot.chatId ? reason : undefined)
    const page = await source.source.read(snapshot.chatId, null, true)
    if (!this.allowed(bot.id, snapshot.chatId)) return
    this.store.write(bot.id, snapshot.chatId, this.project(bot.id, snapshot.chatId, page.rows))
  }
  record(bot: string, session: string, event: ChatEvent, key?: string) {
    if (!this.allowed(bot, session) || this.store.excluded(bot, session)) return
    this.store.event(bot, session, event, key)
    if (event.type === 'turn.finished') {
      const dirty = this.dirty.get(bot) ?? new Set<string>()
      dirty.add(session)
      this.dirty.set(bot, dirty)
    }
  }
  close() {
    for (const value of this.sources.values()) value.source.close()
    this.sources.clear()
  }
}
