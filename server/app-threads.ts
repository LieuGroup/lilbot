/** Builds the exchanges between bots and connects them to the engine, the activity service and the browsers. */
import type { EventFrame } from '../shared/protocol'
import { type ActivityService, toolActivity } from './activity/activity-service'
import type { BotPrefsStore } from './bots/bot-prefs-store'
import type { BotService } from './bots/bot-service'
import type { BotStore } from './bots/bot-store'
import type { Workspaces } from './bots/workspaces'
import type { BotEngine } from './engines/bot-engine'
import type { HistoryService } from './history/history-service'
import { threadEvents } from './http/thread-events'
import { CallingChats } from './threads/calling-chats'
import { DelegationControl } from './threads/delegation-control'
import { type DelegationHost, DelegationService } from './threads/delegation-service'
import { ThreadService } from './threads/thread-service'
import type { ThreadStore } from './threads/thread-store'

interface ThreadDeps {
  engine: BotEngine
  store: BotStore
  prefs: BotPrefsStore
  bots: BotService
  workspaces: Workspaces
  history: HistoryService
  activity: ActivityService
  threadStore: ThreadStore
  publish: (frame: EventFrame) => void
}

export function createThreads({ engine, store, prefs, bots, workspaces, history, activity, threadStore, publish }: ThreadDeps) {
  const native = (botId: string) => store.get(botId).engineBotId
  const host: DelegationHost = {
    requireBot: id => bots.requireBot(id),
    listBots: () => bots.listBots(),
    runRoutine: (botId, prompt, options) => bots.runRoutine(botId, prompt, options),
    folder: botId => workspaces.ensure(botId),
    stopRun: async (botId, chatId) => (await engine.stopRun?.(native(botId), chatId)) ?? false,
    steerRun: async (botId, chatId, text) => (await engine.steerRun?.(native(botId), chatId, text)) ?? 'not_running'
  }
  const threads = new ThreadService(
    threadStore,
    host,
    () =>
      threadEvents(threadStore, store, prefs, publish, (botId, chatId, item, at) => {
        if (store.exists(botId)) history.store.reference(botId, chatId, item, at)
      }),
    (d, working) => {
      for (const botId of [d.sender, d.target])
        if (store.exists(botId)) activity.observe({ botId, chatId: `thread:${d.id}`, key: `${d.id}:${working}:${Date.now()}`, status: working ? 'working' : 'finished' })
    },
    () => publish({ event: 'threads.changed' })
  )
  const calls = new CallingChats(botId => prefs.mainChat(botId))
  engine.onToolCall?.(call => {
    const bot = store.list().find(b => b.engineId === engine.id && b.engineBotId === call.engineBotId)
    if (!bot) return
    calls.saw(bot.id, call.chatId, call.tool, call.args)
    threads.runner.sawTool(call.chatId, toolActivity(call.tool))
  })
  const delegation = { hand: new DelegationService(threads, host, (botId, requestId) => calls.find(botId, requestId)), control: new DelegationControl(threads, host) }
  return { threads, delegation }
}
