/** Builds the work board's service and its checks and connects them to the bots, exchanges, routine runs, activity, history
 *  and browsers; Oscar's side (`WorkBoard`) is built after the exchanges, which it stops and answers through. */
import type { Database } from 'bun:sqlite'
import type { z } from 'zod'
import type { BotModel } from '../shared/bot-schema'
import type { ChatItem } from '../shared/chat-schema'
import type { GiveFileInput } from '../shared/library-schema'
import { LilBotError } from '../shared/lilbot-error'
import type { EventFrame } from '../shared/protocol'
import type { ActivityService } from './activity/activity-service'
import type { BotPrefsStore } from './bots/bot-prefs-store'
import type { BotService } from './bots/bot-service'
import type { BotStore } from './bots/bot-store'
import type { SessionRoot } from './bots/hidden-chats'
import type { Workspaces } from './bots/workspaces'
import { boardLine } from './devices/origin-line'
import type { BotEngine } from './engines/bot-engine'
import { requireAgreed } from './goals/goal-rules'
import type { GoalStore } from './goals/goal-store'
import type { HistoryStore } from './history/history-store'
import type { LibraryService } from './library/library-service'
import type { LibraryStore } from './library/library-store'
import type { RoutineStore } from './routines/routine-store'
import type { CallingChats } from './threads/calling-chats'
import type { ThreadStore } from './threads/thread-store'
import type { WebhookStore } from './webhooks/webhook-store'
import { checkSessions } from './work/check-sessions'
import { WorkAnswers } from './work/work-answers'
import { CHECK_TOOLSETS, differentModel } from './work/work-check-rules'
import { WorkCheckRunner } from './work/work-check-runner'
import { WorkLinks } from './work/work-links'
import { type SessionOrigin, WorkService } from './work/work-service'
import { type StoredItem, WorkStore } from './work/work-store'

interface WorkDeps {
  database: Database
  engine: BotEngine
  store: BotStore
  prefs: BotPrefsStore
  bots: BotService
  threadStore: ThreadStore
  routineStore: RoutineStore
  webhookStore: WebhookStore
  rootOf: SessionRoot
  goalStore: GoalStore
  libraryStore: LibraryStore
  workspaces: Workspaces
  activity: ActivityService
  history: Pick<HistoryStore, 'reference'>
  calls: CallingChats
  /** `LILBOT_REVIEW_MODEL`: what a same-bot check runs on when it differs from the bot's own. */
  reviewModel: BotModel | null
  publish: (frame: EventFrame) => void
}

/** The line in a conversation that links to the item opened there. */
const workLine = (item: StoredItem): Extract<ChatItem, { kind: 'tool' }> => ({
  kind: 'tool',
  toolId: `work:${item.id}`,
  workItemId: item.id,
  name: 'work item',
  detail: item.title,
  running: false
})

/** A routine is named by its task. One deleted while its run works is named plainly. */
function routineName(routines: RoutineStore, botId: string, routineId: string) {
  try {
    return routines.get(botId, routineId).description.slice(0, 100)
  } catch {
    return 'A deleted routine'
  }
}

/** Where a bot's session came from: an exchange's hidden session, a routine or webhook run's session, or else a
 *  conversation. A session the engine continued after compressing one of them counts as that one; when the lineage
 *  cannot be read the work is refused for now rather than credited to Oscar. */
export function workSessions(threadStore: ThreadStore, routineStore: RoutineStore, webhookStore: WebhookStore, rootOf: SessionRoot) {
  const known = (botId: string, chatId: string): SessionOrigin | null => {
    const exchange = threadStore.context(botId, chatId)?.thread_id
    if (exchange) {
      const thread = threadStore.get(exchange)
      const asker = thread.participants[0]
      // In a group the leader asks its members; the leader's own group session is its own work. A worker is its own bot's work.
      if (thread.group) return { origin: { kind: 'group', id: exchange }, askedBy: { kind: asker.id === botId ? 'self' : 'bot', id: asker.id, name: asker.name } }
      return { origin: { kind: 'exchange', id: exchange }, askedBy: { kind: thread.worker ? 'self' : 'bot', id: asker.id, name: asker.name } }
    }
    const run = routineStore.runForChat(botId, chatId)
    if (run) {
      const routineId = routineStore.run(botId, run).routineId
      return { origin: { kind: 'routine_run', id: run }, askedBy: { kind: 'routine', id: routineId, name: routineName(routineStore, botId, routineId) } }
    }
    const hook = webhookStore.runForChat(botId, chatId)
    if (hook) return { origin: { kind: 'webhook_run', id: hook.runId }, askedBy: { kind: 'webhook', id: hook.webhookId, name: hook.task.slice(0, 100) } }
    return null
  }
  return (botId: string, chatId: string): SessionOrigin => {
    const direct = known(botId, chatId)
    if (direct) return direct
    const root = rootOf(botId, chatId)
    if (root === null) throw new LilBotError('session_unknown', 'LilBot cannot tell where this session came from just now. Try again in a moment.')
    return (root !== chatId && known(botId, root)) || { origin: { kind: 'conversation', id: chatId }, askedBy: null }
  }
}

/** What `lilbot_give_file` calls: gives a file to the caller's Library from the conversation the call came from. It is found by the call's `requestId` (the engine's tool starts), never taken from an argument. A routine run's session aliases and a session
 *  the engine continued after compressing one resolve to that run; a webhook run's session is recorded as the conversation. A lineage that cannot be read
 *  refuses, as the work board does. */
export function giveFrom(library: LibraryService, calls: CallingChats, ...sessions: Parameters<typeof workSessions>) {
  const session = workSessions(...sessions)
  return async (botId: string, { path, title, requestId }: z.infer<typeof GiveFileInput>) => {
    const chatId = await calls.find(botId, 'lilbot_give_file', requestId)
    const { origin } = session(botId, chatId)
    return library.give(botId, { path, title, chatId, routineRunId: origin.kind === 'routine_run' ? origin.id : undefined })
  }
}

export function createWork({
  database,
  engine,
  store,
  prefs,
  bots,
  threadStore,
  routineStore,
  webhookStore,
  rootOf,
  goalStore,
  libraryStore,
  workspaces,
  activity,
  history,
  calls,
  reviewModel,
  publish
}: WorkDeps) {
  const work = new WorkService(new WorkStore(database), {
    requireBot: id => bots.requireBot(id),
    checkers: async () => (await bots.listBots()).filter(bot => bot.runnable || bot.runtimePending).map(({ id, name }) => ({ id, name })),
    checkModel: async botId => differentModel((await bots.requireBot(botId)).model, reviewModel),
    callingChat: (botId, tool, requestId) => calls.find(botId, tool, requestId),
    session: workSessions(threadStore, routineStore, webhookStore, rootOf),
    libraryTitle: (botId, itemId) => libraryStore.get(botId, itemId)?.title ?? null,
    checkGoal: (botId, goalId) => requireAgreed(goalStore.get(goalId), botId),
    waiting: (botId, itemId, key, on) => {
      if (store.exists(botId)) activity.observe({ botId, chatId: `work:${itemId}`, key, status: on ? 'waiting' : 'finished' })
    },
    line: item => {
      if (item.chatId && store.exists(item.ownerId)) history.reference(item.ownerId, item.chatId, workLine(item), item.createdAt)
    },
    tell: (id, item, prompt, oscar) => answers.queue(id, item, prompt, false, oscar),
    changed: () => publish({ event: 'work.changed' })
  })
  /** The session a bot's answer or notice goes to: the one it came from, else its main conversation. */
  const sessionOf = (botId: string, chatId: string | null) => chatId ?? prefs.mainChat(botId) ?? undefined
  const answers = new WorkAnswers(
    database,
    (botId, prompt, runId, chatId) => bots.runRoutine(botId, prompt, { runId, chatId: sessionOf(botId, chatId), hiddenInput: true, onChat: () => {}, origin: { line: boardLine } }),
    async (botId, chatId) => {
      const session = sessionOf(botId, chatId)
      if (session && store.exists(botId)) await engine.stopRun?.(store.get(botId).engineBotId, session)
    }
  )
  const checks = new WorkCheckRunner(
    work,
    (botId, prompt, runId, onChat, model) => bots.runRoutine(botId, prompt, { runId, hiddenInput: true, onChat, model, toolsets: CHECK_TOOLSETS, origin: { line: boardLine } }),
    (botId, checkId, working) => {
      if (store.exists(botId)) activity.observe({ botId, chatId: `check:${checkId}`, key: `${checkId}:${working}:${Date.now()}`, status: working ? 'working' : 'finished' })
    },
    botId => workspaces.pathFor(botId)
  )
  return { work, answers, checks, links: new WorkLinks(work, answers), checkSessions: checkSessions(work.checks, rootOf) }
}
