/** Service-level engine switch: re-binds a bot to another registered engine, keeping its id, memory, skills,
 *  workspace and readable history while opening a fresh session with a history divider on the target engine. */
import type { BotModel } from '../../shared/bot-schema'
import { LilBotError } from '../../shared/lilbot-error'
import type { EngineRegistry } from '../engines/engine-registry'
import type { HistoryService } from '../history/history-service'
import type { BotMemory } from './bot-memory'
import type { BotPrefsStore } from './bot-prefs-store'
import type { BotRuntimes } from './bot-runtimes'
import type { SessionSettings } from './bot-session-settings'
import type { BotRecord } from './bot-store'
import type { Workspaces } from './workspaces'

export interface SwitchEngineOptions {
  /** Model on the target engine; undefined keeps the bot's current model (validated there), null resets to engine default. */
  model?: BotModel | null
  /** When true, deletes the old runtime on the previous engine after the new binding is saved. Defaults to false. */
  deleteOldRuntime?: boolean
}

export interface SwitchEngineDeps {
  engines: EngineRegistry
  runtimes: BotRuntimes
  prefs: BotPrefsStore
  workspaces: Workspaces
  sessions: SessionSettings
  botMemory: BotMemory
  history?: HistoryService
  changed: () => void
}

export async function switchBotEngine(deps: SwitchEngineDeps, botId: string, targetEngineId: string, options: SwitchEngineOptions = {}) {
  const previous = await deps.runtimes.require(botId)
  const target = deps.engines.require(targetEngineId)
  if (!target.supportedPermissionModes.includes(previous.permissionMode)) {
    throw new LilBotError('unsupported_permission_mode', `Engine ${target.id} does not support permission mode "${previous.permissionMode}".`)
  }
  if (previous.engineId === target.id) {
    return { ok: true as const, changed: false as const, chatId: deps.prefs.mainChat(botId), bot: previous }
  }

  const nextModel = options.model === undefined ? previous.model : options.model
  if (nextModel) await target.validateModel(nextModel)

  const candidate: BotRecord = { ...previous, model: nextModel, isDefault: false, engineId: target.id, engineBotId: previous.id }
  const nativeId = await target.createRuntime(candidate)
  const nextBot: BotRecord = { ...candidate, engineBotId: nativeId }

  let bound = false
  try {
    await target.prepareRuntime?.(nativeId, nextBot)
    const workspace = await deps.workspaces.ensure(botId)
    await deps.runtimes.release(botId)
    deps.runtimes.store.bindEngine(botId, target.id, nativeId, nextModel)
    bound = true
    deps.history?.dropSource(botId)
    deps.sessions.forget(botId)
    await deps.runtimes.state(nextBot)
    await deps.botMemory.connectNew(botId)

    const chat = await target.openChat(nativeId, null, { workspace }, () => {})
    const newChatId = chat.snapshot.chatId
    chat.close()
    deps.prefs.setMainChat(botId, newChatId)
    deps.sessions.resetContext(botId, newChatId)
    if (deps.history) {
      const now = Date.now()
      deps.history.store.session(botId, newChatId, now)
      deps.history.store.divider(botId, newChatId, now, 'engine_switched')
    }
  } catch (error) {
    if (bound) deps.runtimes.store.bindEngine(botId, previous.engineId, previous.engineBotId, previous.model, previous.isDefault)
    await target.deleteRuntime(nativeId).catch(() => {})
    throw error
  }

  if (options.deleteOldRuntime) {
    const oldEngine = deps.engines.get(previous.engineId)
    if (oldEngine) {
      await oldEngine.deleteRuntime(previous.engineBotId).catch(error => {
        if (!(error instanceof LilBotError && (error.code === 'bot_not_found' || error.code === 'protected_bot'))) throw error
      })
    }
  }

  deps.changed()
  return { ok: true as const, changed: true as const, chatId: deps.prefs.mainChat(botId), bot: deps.runtimes.store.get(botId) }
}
