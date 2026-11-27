/** Sessions the engine runs for a bot without a browser: routine and thread runs, and the after-chat memory review.
 *  A run starts with its explicit reasoning effort when its model thinks, else the bot's effort on the bot's own model. */
import { LilBotError } from '../../shared/lilbot-error'
import type { ReviewOptions, RoutineOptions } from '../engines/bot-engine'
import { allowsMemoryForScope, type MemoryTurnContext } from '../memory/memory-turn-context'
import type { BotRuntimes } from './bot-runtimes'
import type { SessionSettings } from './bot-session-settings'
import type { BotRecord } from './bot-store'
import { withTurnLine } from './runtime-tools'
import type { Workspaces } from './workspaces'

export class BackgroundRuns {
  private active = new Map<string, number>()
  constructor(
    private runtimes: BotRuntimes,
    private workspaces: Workspaces,
    private sessions: SessionSettings,
    private memoryContext?: MemoryTurnContext
  ) {}

  hasActiveRun(botId: string): boolean {
    return (this.active.get(botId) ?? 0) > 0
  }

  private async track<T>(botId: string, run: () => Promise<T>): Promise<T> {
    this.active.set(botId, (this.active.get(botId) ?? 0) + 1)
    try {
      return await run()
    } finally {
      const next = (this.active.get(botId) ?? 1) - 1
      if (next > 0) this.active.set(botId, next)
      else this.active.delete(botId)
    }
  }

  routine(bot: BotRecord, prompt: string, options: RoutineOptions) {
    return this.track(bot.id, async () => {
      await this.runtimes.use(bot)
      const reasoningEffort = options.reasoningEffort
        ? (await this.sessions.thinks(options.model ?? bot.model, bot.engineId))
          ? options.reasoningEffort
          : undefined
        : options.model
          ? undefined
          : await this.sessions.forNewSession(bot)
      const mem = allowsMemoryForScope(options.access) ? this.memoryContext?.prepare(bot.id, options.chatId) : undefined
      let resolvedChat = options.chatId
      const given = withTurnLine(options, this.runtimes.options.prompt).origin
      const origin = mem?.text ? { ...given, line: [given?.line, mem.text].filter(Boolean).join('\n\n') } : given
      const result = await this.runtimes.engineFor(bot).runRoutine(bot.engineBotId, prompt, {
        ...options,
        origin,
        onChat: id => {
          resolvedChat ??= id
          options.onChat(id)
        },
        workspace: await this.workspaces.ensure(bot.id),
        reasoningEffort
      })
      mem?.taken(resolvedChat)
      return result
    })
  }

  review(bot: BotRecord, prompt: string, options: ReviewOptions) {
    return this.track(bot.id, async () => {
      try {
        await this.runtimes.use(bot)
        return await this.runtimes.engineFor(bot).reviewMemory(bot.engineBotId, prompt, {
          ...options,
          workspace: options.workspace ?? (await this.workspaces.ensure(bot.id))
        })
      } catch (error) {
        // The app still owns this bot. A lost runtime must not discard its waiting turns.
        if (error instanceof LilBotError && error.code === 'bot_not_found') throw new LilBotError('runtime_unavailable', 'This bot’s runtime is missing.')
        throw error
      }
    })
  }
}
