import type { ChatEvent, ChatSnapshot } from '../../shared/chat-schema'
import type { SessionReason } from '../../shared/history-schema'
import type { BotEngine, ConversationSource } from '../engines/bot-engine'
import { asEngineRegistry, type EngineRegistry } from '../engines/engine-registry'
import { catchUpDirtySessions, flushBotHistory, type HistoryFlushOptions, type HistoryFlushResult, syncHistoryDividers } from './history-flush'
import type { HistoryRow, HistoryStore } from './history-store'
import { closeSourceQuietly, type PreparedEngineSwitch, prepareSwitchHistory } from './history-switch'

type Binding = { id: string; engineId?: string; engineBotId: string }
type CachedSource = { engineId: string; source: ConversationSource; listed: number; turn: number; known: Set<string> }
const maxDirtyGen = (dirty?: Map<string, number>) => (dirty ? Math.max(0, ...dirty.values()) : 0)

/** A bounded background page per tick, non-blocking post-turn catch-up, and bounded pre-switch flush. */
export class HistoryService {
  private engines: EngineRegistry
  private sources = new Map<string, CachedSource>()
  private connecting = new Map<string, Promise<ConversationSource>>()
  private busy = false
  private inFlight = new Map<string, Promise<void>>()
  private switching = new Set<string>()
  private switchGen = new Map<string, number>()
  private dirty = new Map<string, Map<string, number>>()
  private dirtySeq = 0
  private catchUpTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private switchTimers = new Set<ReturnType<typeof setTimeout>>()
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
  private deps = () => ({ store: this.store, engines: this.engines, dirty: this.dirty, allowed: this.allowed, project: this.project, changed: this.changed })
  private stale = (botId: string, gen: number) => this.closed || this.switching.has(botId) || (this.switchGen.get(botId) ?? 0) !== gen
  private clearCatchUp = (botId: string) => {
    clearTimeout(this.catchUpTimers.get(botId))
    this.catchUpTimers.delete(botId)
  }
  dropSource = (botId: string) => {
    this.clearCatchUp(botId)
    const cached = this.sources.get(botId)
    this.sources.delete(botId)
    closeSourceQuietly(cached?.source)
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
  private trackBot(botId: string, work: (gen: number) => Promise<void>): Promise<void> {
    const [gen, startDirty] = [this.switchGen.get(botId) ?? 0, maxDirtyGen(this.dirty.get(botId))]
    let failed = false
    const task = work(gen)
      .catch(() => {
        failed = true
      })
      .finally(() => {
        if (this.inFlight.get(botId) === task) this.inFlight.delete(botId)
        if (!failed && !this.closed && !this.switching.has(botId) && maxDirtyGen(this.dirty.get(botId)) > startDirty) this.scheduleCatchUp(botId)
      })
    this.inFlight.set(botId, task)
    return task
  }
  async tick() {
    if (this.busy || this.closed) return
    this.busy = true
    try {
      const bots = await this.bindings()
      for (const [id] of this.sources) if (!bots.some(b => b.id === id)) this.dropSource(id)
      for (const bot of bots) {
        if (this.closed || this.switching.has(bot.id) || this.inFlight.has(bot.id)) continue
        await this.trackBot(bot.id, async gen => {
          try {
            const value = await this.source(bot)
            if (!value || this.stale(bot.id, gen)) return
            if (Date.now() - value.listed > 30_000) {
              const listed = await value.source.list()
              if (this.stale(bot.id, gen) || !this.allowed(bot.id, '')) return
              value.known = new Set(listed.map(s => s.id))
              for (const session of listed) if (this.allowed(bot.id, session.id)) this.store.session(bot.id, session.id, session.at)
              this.store.discovered(bot.id)
              value.listed = Date.now()
            }
            const sessions = syncHistoryDividers(this.store, bot.id)
            const pollable = value.listed > 0 ? sessions.filter(s => value.known.has(s.id)) : sessions
            if (!pollable.length) return
            const dirty = this.dirty.get(bot.id)
            const changed = [...(dirty?.keys() ?? [])].find(id => pollable.some(s => s.id === id))
            const session = pollable.find(s => s.id === changed) ?? pollable.find(s => !s.complete) ?? pollable[value.turn++ % pollable.length]
            if (!session || !this.allowed(bot.id, session.id)) return
            const seenGen = dirty?.get(session.id)
            const page = await value.source.read(session.id, session.cursor)
            if (this.stale(bot.id, gen) || !this.allowed(bot.id, session.id)) return
            this.store.write(bot.id, session.id, this.project(bot.id, session.id, page.rows), page.cursor, page.empty || !!session.complete)
            if (page.rows.length || !session.complete) this.changed(bot.id)
            if (page.empty && seenGen !== undefined && dirty?.get(session.id) === seenGen) dirty.delete(session.id)
          } catch {
            this.dropSource(bot.id)
            console.error('[history] import pending; will retry')
            throw new Error('tick_failed')
          }
        })
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
    if (this.closed || this.switching.has(botId) || this.inFlight.has(botId) || !dirty?.size) return
    await this.trackBot(botId, async gen => {
      try {
        const bot = this.sources.has(botId) ? undefined : (await this.bindings()).find(b => b.id === botId)
        const value = this.sources.get(botId) ?? (bot && !this.stale(botId, gen) ? await this.source(bot) : undefined)
        if (value && !this.stale(botId, gen)) await catchUpDirtySessions(this.deps(), botId, value, dirty, () => this.stale(botId, gen))
      } catch {
        this.dropSource(botId)
        throw new Error('catchup_failed')
      }
    })
  }
  flush = (bot: Binding, options?: HistoryFlushOptions): Promise<HistoryFlushResult> => flushBotHistory(this.deps(), bot, options)
  prepareEngineSwitch = (previous: Binding, options?: HistoryFlushOptions): Promise<PreparedEngineSwitch> =>
    prepareSwitchHistory(
      {
        ...this.deps(),
        inFlight: this.inFlight,
        switching: this.switching,
        switchGen: this.switchGen,
        switchTimers: this.switchTimers,
        dropSource: this.dropSource,
        clearCatchUp: this.clearCatchUp
      },
      previous,
      options
    )
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
      const dirty = this.dirty.get(bot) ?? new Map<string, number>()
      dirty.set(session, ++this.dirtySeq)
      this.dirty.set(bot, dirty)
      this.scheduleCatchUp(bot)
    }
  }
  close() {
    this.closed = true
    for (const timer of [...this.catchUpTimers.values(), ...this.switchTimers]) clearTimeout(timer)
    this.catchUpTimers.clear()
    this.switchTimers.clear()
    const sources = [...this.sources.values()]
    this.sources.clear()
    for (const value of sources) closeSourceQuietly(value.source)
  }
}
