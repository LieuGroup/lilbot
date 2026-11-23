/** Builds the exchanges and temporary groups between bots and connects them to the engine, the activity service, memory,
 *  the Library, the work board and the browsers. */
import type { EventFrame } from '../shared/protocol'
import { type ActivityService, toolActivity } from './activity/activity-service'
import type { RemoteWorkers } from './app-remote-workers'
import type { BotPrefsStore } from './bots/bot-prefs-store'
import type { BotService } from './bots/bot-service'
import type { BotStore } from './bots/bot-store'
import type { SessionRoot } from './bots/hidden-chats'
import type { Workspaces } from './bots/workspaces'
import type { BotEngine } from './engines/bot-engine'
import type { HistoryService } from './history/history-service'
import { threadEvents } from './http/thread-events'
import type { LibraryService } from './library/library-service'
import type { MemoryService } from './memory/memory-service'
import type { CallingChats } from './threads/calling-chats'
import { DelegationControl } from './threads/delegation-control'
import { type DelegationHost, DelegationService } from './threads/delegation-service'
import type { GroupHost } from './threads/group-end'
import { groupLimits } from './threads/thread-limits'
import { ThreadService } from './threads/thread-service'
import type { ThreadStore } from './threads/thread-store'
import { webhookRunAccess } from './webhooks/webhook-access'
import type { WebhookCallers } from './webhooks/webhook-callers'
import type { WorkLinks } from './work/work-links'

interface ThreadDeps {
  engine: BotEngine
  store: BotStore
  prefs: BotPrefsStore
  bots: BotService
  workspaces: Workspaces
  history: HistoryService
  activity: ActivityService
  threadStore: ThreadStore
  calls: CallingChats
  work: WorkLinks
  memory: MemoryService
  library: LibraryService
  /** The workspaces folder, where each group's shared folder lives. */
  root: string
  rootOf: SessionRoot
  remoteWorkers?: RemoteWorkers
  callers?: Pick<WebhookCallers, 'forChat' | 'hasRuns'>
  t3Enabled?: boolean
  publish: (frame: EventFrame) => void
  botsChanged: () => void
  memoryChanged: () => void
}

export function createThreads(deps: ThreadDeps) {
  const { engine, store, prefs, bots, workspaces, history, activity, threadStore, calls, work, remoteWorkers, publish } = deps
  const native = (botId: string) => store.get(botId).engineBotId
  const host: DelegationHost = {
    requireBot: id => bots.requireBot(id),
    listBots: () => bots.listBots(),
    runRoutine: (botId, prompt, options) =>
      options.computer && options.cwd && options.threadId && remoteWorkers
        ? remoteWorkers.runForBot(botId, prompt, {
            runId: options.runId,
            threadId: options.threadId,
            chatId: options.chatId,
            computer: options.computer,
            cwd: options.cwd,
            model: options.model,
            reasoningEffort: options.reasoningEffort,
            capabilities: options.capabilities,
            onChat: options.onChat
          })
        : bots.runRoutine(botId, prompt, options),
    sessionCapabilities: deps.callers?.forChat,
    hasNarrowed: deps.callers?.hasRuns,
    narrowedAccess: caps => webhookRunAccess(caps, Boolean(deps.t3Enabled)),
    folder: botId => workspaces.ensure(botId),
    stopRun: async (botId, chatId) =>
      chatId.startsWith('remote:') && remoteWorkers ? remoteWorkers.runner.stopByChat(botId, chatId) : ((await engine.stopRun?.(native(botId), chatId)) ?? false),
    steerRun: async (botId, chatId, text) =>
      chatId.startsWith('remote:') && remoteWorkers
        ? remoteWorkers.runner.steerByChat(botId, chatId, text)
        : ((await engine.steerRun?.(native(botId), chatId, text)) ?? 'not_running'),
    validateModel: model => engine.validateModel(model),
    ...(remoteWorkers
      ? {
          resolveRemoteWorker: remoteWorkers.resolveRemoteWorker,
          computerName: remoteWorkers.computerName,
          activeRemoteThreads: (id: string) => remoteWorkers.runner.activeThreadsForComputer(id)
        }
      : {})
  }
  const groupHost: GroupHost = {
    root: deps.root,
    journal: (botId, text, chatId) => {
      deps.memory.write({ botId, kind: 'journal', scope: 'bot', text, author: 'bot', via: 'chat', sourceChatId: chatId ?? undefined })
      deps.memoryChanged()
    },
    give: async (botId, path, title, chatId) => {
      await deps.library.give(botId, { path, title, chatId })
    },
    callingChat: (botId, requestId) => calls.find(botId, 'lilbot_group', requestId),
    rootOf: deps.rootOf,
    work,
    rosterChanged: deps.botsChanged
  }
  const threads = new ThreadService(
    threadStore,
    host,
    () => {
      threadEvents(threadStore, store, prefs, publish, (botId, chatId, item, at) => {
        if (store.exists(botId)) history.store.reference(botId, chatId, item, at)
      })
      work.settleExchanges(id => threadStore.get(id).stoppedBy?.name ?? null)
    },
    (botId, d, working) => {
      if (store.exists(botId)) activity.observe({ botId, chatId: `thread:${d.id}`, key: `${d.id}:${working}:${Date.now()}`, status: working ? 'working' : 'finished' })
    },
    roster => {
      publish({ event: 'threads.changed' })
      if (roster) deps.botsChanged()
    },
    groupHost,
    groupLimits(process.env)
  )
  engine.onToolCall?.(call => {
    const bot = store.list().find(b => b.engineId === engine.id && b.engineBotId === call.engineBotId)
    if (!bot) return
    calls.saw(bot.id, call.chatId, call.tool, call.args, call.callId)
    threads.runner.sawTool(call.chatId, toolActivity(call.tool))
  })
  remoteWorkers?.runner.onToolCall(call => threads.runner.sawTool(call.chatId, call.activity))
  const hand = new DelegationService(threads, host, (botId, requestId) => calls.find(botId, 'lilbot_delegate', requestId), work)
  const control = new DelegationControl(threads, host, (botId, requestId) => calls.find(botId, 'lilbot_delegation', requestId))
  return { threads, delegation: { hand, control, groups: threads.groups! } }
}
