/** An engine that lives in memory and records what was asked of it, plus a ready-made service
 *  around it with an in-memory database and a temporary workspaces folder. */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ActivityService } from '../../server/activity/activity-service'
import { ActivityStore } from '../../server/activity/activity-store'
import { BotPrefsStore } from '../../server/bots/bot-prefs-store'
import { BotService } from '../../server/bots/bot-service'
import { BotStore } from '../../server/bots/bot-store'
import { Workspaces } from '../../server/bots/workspaces'
import { openDatabase } from '../../server/database/database'
import type { BotEngine, EngineBotDetail, OpenChat } from '../../server/engines/bot-engine'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import { ReviewQueue } from '../../server/memory/review-queue'
import type { BotIdentity } from '../../shared/bot-schema'
import type { ChatEvent } from '../../shared/chat-schema'
import { LilBotError } from '../../shared/protocol'

export const bot: BotIdentity = { id: 'b1', name: 'Bot One', function: '', model: null, isDefault: false, permissionMode: 'full-access' }
export const detail: EngineBotDetail = { ...bot, instructions: '', abilities: [], memoryConnected: false }

export function fakeEngine(options: { earlyEvents?: ChatEvent[] } = {}) {
  const log: string[] = []
  const emitters = new Map<string, (event: ChatEvent) => void>()
  /** Chats the engine "has stored"; resuming any other id yields a new chat, like the real engine. */
  const stored = new Set<string>()
  let chats = 0
  const reviews: string[] = []
  const failReviews = { value: false }
  const runtimeIds = new Set(['b1'])
  const engine: BotEngine = {
    id: 'test',
    runRoutine: async (_botId, _prompt, options) => {
      options.onChat(`routine-${options.runId}`)
      return { status: 'completed', text: 'Done' }
    },
    deleteRuntime: async id => {
      runtimeIds.delete(id)
      log.push(`delete:${id}`)
    },
    supportedPermissionModes: ['full-access'],
    importBots: async () => [detail],
    createRuntime: async identity => {
      runtimeIds.add(identity.id)
      return identity.id
    },
    applyIdentity: async id => {
      if (!runtimeIds.has(id)) throw new LilBotError('bot_not_found', 'That bot does not exist.')
      return { abilities: [], memoryConnected: false }
    },
    listModels: async () => [],
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
  return { engine, runtimeIds, log, stored, reviews, failReviews, emit: (chatId: string, event: ChatEvent) => emitters.get(chatId)?.(event) }
}

export function fakeService(options?: Parameters<typeof fakeEngine>[0]) {
  const fake = fakeEngine(options)
  const database = openDatabase(':memory:')
  const store = new BotStore(database)
  store.import('test', [{ ...detail, engineId: 'test', engineBotId: bot.id }])
  const prefs = new BotPrefsStore(database)
  const memory = new MemoryService(new MemoryStore(database))
  const root = mkdtempSync(join(tmpdir(), 'lilbot-ws-'))
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
    memoryConnection: { url: 'http://127.0.0.1:3370', tokenFile: '/nowhere/engine-token' }
  })
  return { ...fake, activity, queue, database, service, store, prefs, memory, root, changes: () => changes, memoryChanges: () => memoryChanges }
}
