/** An engine that lives in memory and records what was asked of it, plus a ready-made service
 *  around it with an in-memory database and a temporary workspaces folder. */
import { afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ActivityService } from '../../server/activity/activity-service'
import { ActivityStore } from '../../server/activity/activity-store'
import { BotPrefsStore } from '../../server/bots/bot-prefs-store'
import { BotService } from '../../server/bots/bot-service'
import { BotStore } from '../../server/bots/bot-store'
import { Workspaces } from '../../server/bots/workspaces'
import { openDatabase } from '../../server/database/database'
import type { BotEngine, EngineBotDetail, OpenChat, SessionChange } from '../../server/engines/bot-engine'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import { ReviewQueue } from '../../server/memory/review-queue'
import type { BotIdentity, ModelProvider } from '../../shared/bot-schema'
import type { ChatEvent } from '../../shared/chat-schema'
import { LilBotError } from '../../shared/lilbot-error'

export const bot: BotIdentity = { id: 'b1', name: 'Bot One', function: '', model: null, reasoningEffort: null, isDefault: false, permissionMode: 'full-access' }
export const nativeBotId = 'native-b1'
export const detail: EngineBotDetail = { ...bot, instructions: '', abilities: [], memoryConnected: false }

export function fakeEngine(options: { earlyEvents?: ChatEvent[] } = {}) {
  const log: string[] = []
  const emitters = new Map<string, (event: ChatEvent) => void>()
  /** Chats the engine "has stored"; resuming any other id yields a new chat, like the real engine. */
  const stored = new Set<string>()
  let chats = 0
  const reviews: string[] = []
  const failReviews = { value: false }
  const models = { value: [] as ModelProvider[] }
  const sessionChanges: { botId: string; chatId: string; change: SessionChange }[] = []
  const failUpdates = { value: false }
  /** The engine holds back every model switch for a confirmation, like a conversation of 100,000+ tokens. */
  const holdModelSwitch = { value: false }
  /** What each new session was asked to start with. */
  const created: { chatId: string; reasoningEffort?: string }[] = []
  const runtimeIds = new Set([nativeBotId])
  const engine: BotEngine = {
    id: 'test',
    runRoutine: async (_botId, _prompt, options) => {
      created.push({ chatId: `routine-${options.runId}`, reasoningEffort: options.reasoningEffort })
      options.onChat(`routine-${options.runId}`)
      return { status: 'completed', text: 'Done' }
    },
    deleteRuntime: async id => {
      runtimeIds.delete(id)
      log.push(`delete:${id}`)
    },
    supportedPermissionModes: ['full-access'],
    importBots: async () => [{ ...detail, id: nativeBotId }],
    createRuntime: async identity => {
      const nativeId = `native-${identity.id}`
      runtimeIds.add(nativeId)
      return nativeId
    },
    applyIdentity: async id => {
      if (!runtimeIds.has(id)) throw new LilBotError('bot_not_found', 'That bot does not exist.')
      return { abilities: [], memoryConnected: false }
    },
    validateModel: async () => {},
    listModels: async () => models.value,
    updateSession: async (botId, chatId, change) => {
      sessionChanges.push({ botId, chatId, change })
      if (failUpdates.value) throw new LilBotError('engine_unavailable', 'The connection to Hermes is closed.')
      if (holdModelSwitch.value && change.model) throw new LilBotError('confirm_required', 'The engine asks for a confirmation.')
      return { effort: change.reasoningEffort === undefined ? null : change.reasoningEffort }
    },
    onBotsChanged: () => () => {},
    refreshMemory: async () => [],
    reviewMemory: async (botId, prompt, reviewOptions) => {
      reviewOptions.onChat(`review-of-${botId}`)
      log.push(`review:${botId}:${reviewOptions.model?.model ?? 'bot model'}`)
      reviews.push(prompt)
      if (failReviews.value) throw new Error('engine down')
    },
    connectMemory: async botId => {
      log.push(`connect-memory:${botId}`)
      return { aboutUser: ['Oscar lives in Adelaide.'], ownNotes: ['The build takes 30 minutes.', 'x'.repeat(900)] }
    },
    openChat: async (botId, chatId, chatOptions, onEvent): Promise<OpenChat> => {
      const id = chatId && stored.has(chatId) ? chatId : `chat-${++chats}`
      if (!stored.has(id)) created.push({ chatId: id, reasoningEffort: chatOptions.reasoningEffort })
      stored.add(id)
      log.push(`open:${id}:${chatOptions.workspace.split('/').at(-1)}`)
      emitters.set(id, onEvent)
      for (const early of options.earlyEvents ?? []) onEvent(early)
      return {
        snapshot: { chatId: id, botId, title: '', running: false, workspace: chatOptions.workspace, items: [] },
        send: async (text, options) => {
          log.push(`send:${id}:${text}`)
          if (options?.hidden) log.push(`hidden:${options.inputId}`)
        },
        stop: async () => void log.push(`stop:${id}`),
        close: () => void log.push(`close:${id}`)
      }
    }
  }
  return {
    engine,
    runtimeIds,
    log,
    stored,
    reviews,
    failReviews,
    models,
    sessionChanges,
    failUpdates,
    holdModelSwitch,
    created,
    emit: (chatId: string, event: ChatEvent) => emitters.get(chatId)?.(event)
  }
}

export function fakeService(options?: Parameters<typeof fakeEngine>[0]) {
  const fake = fakeEngine(options)
  const database = openDatabase(':memory:')
  const store = new BotStore(database)
  store.import('test', [{ ...detail, engineId: 'test', engineBotId: nativeBotId }])
  const prefs = new BotPrefsStore(database)
  const memory = new MemoryService(new MemoryStore(database))
  const root = mkdtempSync(join(tmpdir(), 'lilbot-ws-'))
  // Removed when the test file (or the describe block that made it) finishes, so no caller has to remember it.
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  let changes = 0
  let memoryChanges = 0
  const activity = new ActivityService(new ActivityStore(database), () => {})
  const queue = new ReviewQueue(database)
  const service = new BotService(fake.engine, store, prefs, new Workspaces(root), memory, {
    cleanupBot: id => {
      activity.forgetBot(id)
      queue.forgetBot(id)
    },
    changed: () => changes++,
    memoryChanged: () => memoryChanges++,
    memoryConnection: botId => ({ url: 'http://127.0.0.1:3370', checkpointKey: `ckpt-${botId}`, botId }),
    skillConnection: { url: 'http://127.0.0.1:3370', tokenFile: '/nowhere/engine-token' }
  })
  return { ...fake, activity, queue, database, service, store, prefs, memory, root, changes: () => changes, memoryChanges: () => memoryChanges }
}
