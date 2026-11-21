/** What a bot's model and reasoning effort mean for its conversations: the effort a new session starts with, what an edit does to
 *  the open main conversation, and the level the engine says it really sends there. */
import type { BotModel, BotUpdateInput, ModelProvider, ReasoningEffort } from '../../shared/bot-schema'
import { LilBotError } from '../../shared/lilbot-error'
import type { BotEngine, SessionChange } from '../engines/bot-engine'
import type { BotPrefsStore } from './bot-prefs-store'
import type { BotRecord } from './bot-store'

const MODELS_FRESH_MS = 60_000
/** The engine's switch guard is confirmed only with a token its contract does not declare, so LilBot never confirms it. */
const KEPT_MODEL = 'This long conversation keeps its model until New session; new conversations use the new one.'
const sameModel = (a: BotModel | null | undefined, b: BotModel | null | undefined) => a?.provider === b?.provider && a?.model === b?.model

export class SessionSettings {
  private effective = new Map<string, string | null>()
  /** Bots whose last edit did not reach their open conversation: the next edit tries again even if nothing differs. */
  private unapplied = new Set<string>()
  private edits = new Map<string, Promise<unknown>>()
  private models?: { at: number; providers: Promise<ModelProvider[]> }

  constructor(
    private engine: BotEngine,
    private prefs: BotPrefsStore,
    private changed: () => void
  ) {}

  /** The level the engine reports for the main conversation, or undefined until it has. */
  effectiveFor(botId: string): string | null | undefined {
    return this.effective.get(botId)
  }

  noteEffective(botId: string, effort: string | null) {
    if (this.effective.has(botId) && this.effective.get(botId) === effort) return
    this.effective.set(botId, effort)
    this.changed()
  }

  forget(botId: string) {
    this.effective.delete(botId)
    this.unapplied.delete(botId)
  }

  /** The effort a session made for this bot now starts with. The saved choice stays for a model that does not think. */
  async forNewSession(bot: BotRecord): Promise<ReasoningEffort | undefined> {
    return bot.reasoningEffort && (await this.thinks(bot.model)) ? bot.reasoningEffort : undefined
  }

  /** After an edit is saved: switch the open main conversation from its next message. Edits to one bot run in order. */
  apply(bot: BotRecord, previous: BotRecord, patch: Pick<BotUpdateInput, 'model' | 'reasoningEffort'>): Promise<void> {
    const run = async () => {
      const chatId = this.prefs.mainChat(bot.id)
      const touches = patch.model !== undefined || patch.reasoningEffort !== undefined
      const retry = touches && this.unapplied.has(bot.id)
      const modelChanged = !!patch.model && !sameModel(patch.model, previous.model)
      const effortChanged = patch.reasoningEffort !== undefined && patch.reasoningEffort !== previous.reasoningEffort
      if (!chatId || !(modelChanged || effortChanged || retry)) return
      const change: SessionChange = {}
      if ((modelChanged || retry) && bot.model) change.model = bot.model
      if (await this.thinks(bot.model)) change.reasoningEffort = bot.reasoningEffort
      if (!change.model && change.reasoningEffort === undefined) return
      try {
        const result = await this.engine.updateSession(bot.engineBotId, chatId, change)
        this.unapplied.delete(bot.id)
        if (result) this.noteEffective(bot.id, result.effort)
      } catch (error) {
        // A switch the engine holds back is an answer, not a failure to retry: the choice stays saved and the level still applies.
        if (!(error instanceof LilBotError && error.code === 'confirm_required')) {
          this.unapplied.add(bot.id)
          throw error
        }
        console.warn(`[bots] model switch held back by the engine (${bot.id}: ${error.code})`)
        if (change.model && change.reasoningEffort !== undefined)
          await this.engine.updateSession(bot.engineBotId, chatId, { reasoningEffort: change.reasoningEffort }).then(result => result && this.noteEffective(bot.id, result.effort))
        throw new LilBotError('confirm_required', KEPT_MODEL)
      }
    }
    const turn = (this.edits.get(bot.id) ?? Promise.resolve()).catch(() => {}).then(run)
    this.edits.set(bot.id, turn)
    return turn
  }

  /** Whether the model thinks. A model the engine does not list, or the engine's own default, is taken to think: the engine adapts. */
  private async thinks(model: BotModel | null): Promise<boolean> {
    if (!model) return true
    try {
      for (const provider of await this.providers()) {
        const known = provider.provider === model.provider && provider.capabilities.find(capability => capability.id === model.model)
        if (known) return known.reasoning
      }
    } catch {
      // The engine could not say. A level for a model that does not think is harmless there, so send it.
    }
    return true
  }

  private providers(): Promise<ModelProvider[]> {
    if (!this.models || Date.now() - this.models.at > MODELS_FRESH_MS) {
      const providers = this.engine.listModels()
      this.models = { at: Date.now(), providers }
      providers.catch(() => {
        this.models = undefined
      })
    }
    return this.models.providers
  }
}
