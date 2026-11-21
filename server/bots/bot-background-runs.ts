/** Sessions the engine runs for a bot without a browser: routine and thread runs, and the after-chat memory review.
 *  A run starts with the bot's reasoning effort; the review, and a run given another model, keep their own model and are not given it. */
import { LilBotError } from '../../shared/protocol'
import type { ReviewOptions, RoutineOptions } from '../engines/bot-engine'
import type { BotRuntimes } from './bot-runtimes'
import type { SessionSettings } from './bot-session-settings'
import type { BotRecord } from './bot-store'
import type { Workspaces } from './workspaces'

export class BackgroundRuns {
  constructor(
    private runtimes: BotRuntimes,
    private workspaces: Workspaces,
    private sessions: SessionSettings
  ) {}

  async routine(bot: BotRecord, prompt: string, options: RoutineOptions) {
    await this.runtimes.use(bot)
    return this.runtimes.engineFor(bot).runRoutine(bot.engineBotId, prompt, {
      ...options,
      workspace: await this.workspaces.ensure(bot.id),
      reasoningEffort: options.model ? undefined : await this.sessions.forNewSession(bot)
    })
  }

  async review(bot: BotRecord, prompt: string, options: ReviewOptions) {
    try {
      await this.runtimes.use(bot)
      return await this.runtimes.engineFor(bot).reviewMemory(bot.engineBotId, prompt, options)
    } catch (error) {
      // The app still owns this bot. A lost runtime must not discard its waiting turns.
      if (error instanceof LilBotError && error.code === 'bot_not_found') throw new LilBotError('runtime_unavailable', 'This bot’s runtime is missing.')
      throw error
    }
  }
}
