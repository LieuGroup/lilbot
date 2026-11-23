import type { ChatEvent, ChatSnapshot } from '../../shared/chat-schema'
import type { SessionReason } from '../../shared/history-schema'
import type { BotEngine, ConversationSource } from '../engines/bot-engine'
import { asEngineRegistry, type EngineRegistry } from '../engines/engine-registry'
import { catchUpDirtySessions, flushBotHistory, type HistoryFlushOptions, type HistoryFlushResult, syncHistoryDividers } from './history-flush'
import type { HistoryRow, HistoryStore } from './history-store'

type Binding = { id: string; engineId?: string; engineBotId: string }
type CachedSource = { engineId: string; source: ConversationSource; listed: number; turn: number; known: Set<string> }

/** A bounded background page per tick, non-blocking post-turn catch-up, and bounded pre-switch flush. */
export class HistoryService {
  private engines: EngineRegistry
  private sources = new Map<string, CachedSource>()
  private connecting = new Map<string, Promise<ConversationSource>>()
  private busy = false
  private botBusy = new Set<string>()
  private switching = new Set<string>()
  private dirty = new Map<string, Set<string>>()
  private catchUpTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private closed = false

  constructor(
    readonly store: HistoryStore,
    engine: BotEngine | EngineRegistry,
    private bindings: () => Promise<Binding[]>,
    private allowed: (bot: string, session: string) => boolean,
    private project: (bot: string, session: string, rows: HistoryRow[]) => HistoryRow[] = (_b, _s, rows) => rows,
    private changed: (bot: string) => void = () => {}
  ) {
    this.engines = asEngineRegistry(engine)
  }

  private deps() {
    return { store: this.store, engines: this.engines, dirty: this.dirty, allowed: this.allowed, project: this.project, changed: this.changed }
  }

  dropSource(botId: string) {
    clearTimeout(this.catchUpTimers.get(botId))
    this.catchUpTimers.delete(botId)
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
      const attempt = this.connecting.get(bot.id) ?? engine.conversations(bot.engineBotId)
      this.connecting.set(bot.id, attempt)
      try {
        value = { engineId, source: await attempt, listed: 0, turn: 0, known: new Set() }
      } finally {
        this.connecting.delete(bot.id)
      }
      this.sources.set(bot.id, value)
    }
    return value
  }

  async tick() {
    if (this.busy || this.closed) return
    this.busy = true
    try {
      const bots = await this.bindings()
      for (const [id] of this.sources) if (!bots.some(b => b.id === id)) this.dropSource(id)
      for (const bot of bots) {
        if (this.closed || this.switching.has(bot.id) || this.botBusy.has(bot.id)) continue
        this.botBusy.add(bot.id)
        try {
          const value = await this.source(bot)
          if (!value) continue
          if (Date.now() - value.listed > 30_000) {
            const listed = await value.source.list()
            if (!this.allowed(bot.id, '')) continue
            value.known = new Set(listed.map(s => s.id))
            for (const session of listed) if (this.allowed(bot.id, session.id)) this.store.session(bot.id, session.id, session.at)
            this.store.discovered(bot.id)
            value.listed = Date.now()
          }
          const sessions = syncHistoryDividers(this.store, bot.id)
          const pollable = value.listed > 0 ? sessions.filter(s => value.known.has(s.id)) : sessions
          if (!pollable.length) continue
          const dirty = this.dirty.get(bot.id)
          const changed = [...(dirty ?? [])].find(id => pollable.some(s => s.id === id))
          const session = pollable.find(s => s.id === changed) ?? pollable.find(s => !s.complete) ?? pollable[value.turn++ % pollable.length]
          if (!session || !this.allowed(bot.id, session.id)) continue
          const page = await value.source.read(session.id, session.cursor)
          if (!this.allowed(bot.id, session.id)) continue
          this.store.write(bot.id, session.id, this.project(bot.id, session.id, page.rows), page.cursor, page.empty || !!session.complete)
          if (page.rows.length || !session.complete) this.changed(bot.id)
          if (page.empty) dirty?.delete(session.id)
        } catch {
          this.dropSource(bot.id)
          console.error('[history] import pending; will retry')
        } finally {
          this.botBusy.delete(bot.id)
        }
      }
    } finally {
      this.busy = false
    }
  }

  private scheduleCatchUp(botId: string) {
    if (this.closed || this.switching.has(botId) || this.catchUpTimers.has(botId)) return
    this.catchUpTimers.set(
      botId,
      setTimeout(() => {
        this.catchUpTimers.delete(botId)
        void this.catchUp(botId)
      }, 25)
    )
  }

  private async catchUp(botId: string) {
    const dirty = this.dirty.get(botId)
    if (this.closed || this.switching.has(botId) || this.botBusy.has(botId) || !dirty?.size) return
    this.botBusy.add(botId)
    try {
      const bot = this.sources.has(botId) ? undefined : (await this.bindings()).find(b => b.id === botId)
      const value = this.sources.get(botId) ?? (bot && !this.closed && !this.switching.has(botId) ? await this.source(bot) : undefined)
      if (!value) return
      await catchUpDirtySessions(this.deps(), botId, value, dirty, () => this.closed || this.switching.has(botId))
    } catch {
      this.dropSource(botId)
    } finally {
      this.botBusy.delete(botId)
    }
  }

  flush(bot: Binding, options?: HistoryFlushOptions): Promise<HistoryFlushResult> {
    return flushBotHistory(this.deps(), bot, options)
  }

  /** Flushes the previous engine before binding changes and returns the commit hook that seals old sessions and writes the divider. */
  async prepareEngineSwitch(previous: Binding, options?: HistoryFlushOptions): Promise<(newChatId: string) => void> {
    this.switching.add(previous.id)
    let result: HistoryFlushResult
    try {
      result = await this.flush(previous, options)
    } finally {
      this.dropSource(previous.id)
      this.switching.delete(previous.id)
    }
    return (newChatId: string) => {
      const reason: SessionReason = result.incomplete ? 'engine_switched_gap' : 'engine_switched'
      this.store.db.transaction(() => {
        this.store.sealSessions(previous.id)
        this.dirty.delete(previous.id)
        const now = Date.now()
        this.store.session(previous.id, newChatId, now)
        this.store.divider(previous.id, newChatId, now, reason)
      })()
      this.changed(previous.id)
    }
  }

  async latest(bot: Binding, snapshot: ChatSnapshot, reason?: SessionReason) {
    const source = await this.source(bot)
    if (!source || !this.allowed(bot.id, snapshot.chatId)) return
    source.known.add(snapshot.chatId)
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
    this.sources.get(bot)?.known.add(session)
    if (event.type === 'turn.finished') {
      const dirty = this.dirty.get(bot) ?? new Set<string>()
      dirty.add(session)
      this.dirty.set(bot, dirty)
      this.scheduleCatchUp(bot)
    }
  }

  close() {
    this.closed = true
    for (const timer of this.catchUpTimers.values()) clearTimeout(timer)
    this.catchUpTimers.clear()
    for (const value of this.sources.values()) value.source.close()
    this.sources.clear()
  }
}
