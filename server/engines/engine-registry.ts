/** Registry of available bot engines, keyed by engine id. Keeps engine lookup and multi-engine wiring out of services. */
import type { ActivityEvent } from '../../shared/activity-schema'
import type { ChatEvent } from '../../shared/chat-schema'
import { LilBotError } from '../../shared/lilbot-error'
import type { ActivityCursor, BotEngine, MemoryConnection, RuntimeBinding } from './bot-engine'

export class EngineRegistry {
  private readonly byId = new Map<string, BotEngine>()
  private readonly fallback?: BotEngine
  readonly defaultId: string

  constructor(engines: readonly BotEngine[], defaultEngineId?: string, allowUnnamed = false) {
    if (!engines.length) throw new Error('EngineRegistry requires at least one engine.')
    if (allowUnnamed && engines.length === 1 && !engines[0].id) {
      this.fallback = engines[0]
      this.defaultId = defaultEngineId ?? 'default'
      return
    }
    for (const engine of engines) {
      if (!engine.id) throw new Error('Every registered engine must have a non-empty id.')
      if (this.byId.has(engine.id)) throw new Error(`Duplicate engine id: ${engine.id}`)
      this.byId.set(engine.id, engine)
    }
    this.defaultId = defaultEngineId ?? engines[0].id
    if (!this.byId.has(this.defaultId)) throw new Error(`Default engine "${this.defaultId}" is not registered.`)
  }

  get defaultEngine(): BotEngine {
    return this.fallback ?? this.byId.get(this.defaultId)!
  }

  get(engineId: string): BotEngine | undefined {
    return this.byId.get(engineId) ?? this.fallback
  }

  require(engineId: string): BotEngine {
    const engine = this.get(engineId)
    if (!engine) throw new LilBotError('runtime_unavailable', 'This bot’s engine is not available.')
    return engine
  }

  has(engineId: string): boolean {
    return this.byId.has(engineId) || !!this.fallback
  }

  list(): BotEngine[] {
    return this.fallback ? [this.fallback] : [...this.byId.values()]
  }

  ids(): string[] {
    return this.fallback ? [this.defaultId] : [...this.byId.keys()]
  }

  mcpToolName(engineId: string | undefined, server: string, tool: string): string {
    const engine = engineId ? this.get(engineId) : this.defaultEngine
    return engine?.mcpToolName?.(server, tool) ?? `mcp__${server}__${tool}`
  }

  onBotsChanged(listener: () => void): () => void {
    const stops = this.list().map(engine => engine.onBotsChanged(listener))
    return () => {
      for (const stop of stops) stop()
    }
  }

  async refreshMemory(bindingsFor: (engineId: string) => RuntimeBinding[], connection?: MemoryConnection): Promise<string[]> {
    const updated: string[] = []
    for (const engine of this.list()) {
      const id = engine.id || this.defaultId
      const bots = bindingsFor(id)
      if (bots.length) updated.push(...(await engine.refreshMemory(bots, connection)))
    }
    return updated
  }

  watchActivity(
    bindingsFor: (engineId: string) => Promise<RuntimeBinding[]>,
    listener: (event: ActivityEvent) => void,
    cursor: ActivityCursor,
    availability: (engineId: string, nativeId: string, available: boolean) => void,
    conversationEvent: (botId: string, chatId: string, event: ChatEvent, key: string) => void
  ): () => void {
    const stops = this.list().flatMap(engine => {
      const id = engine.id || this.defaultId
      const stop = engine.watchActivity?.(
        () => bindingsFor(id),
        listener,
        cursor,
        (nativeId, ok) => availability(id, nativeId, ok),
        conversationEvent
      )
      return stop ? [stop] : []
    })
    return () => {
      for (const stop of stops) stop()
    }
  }
}

export function asEngineRegistry(engine: BotEngine | EngineRegistry): EngineRegistry {
  return engine instanceof EngineRegistry ? engine : new EngineRegistry([engine], undefined, true)
}
