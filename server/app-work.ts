/** Builds the work board's service and its checks and connects them to the bots, exchanges, routine runs, activity, history
 *  and browsers; Oscar's side (`WorkBoard`) is built after the exchanges, which it stops and answers through. */
import type { Database } from 'bun:sqlite'
import type { ChatItem } from '../shared/chat-schema'
import { type EventFrame, LilBotError } from '../shared/protocol'
import type { ActivityService } from './activity/activity-service'
import type { BotPrefsStore } from './bots/bot-prefs-store'
import type { BotService } from './bots/bot-service'
import type { BotStore } from './bots/bot-store'
import type { SessionRoot } from './bots/hidden-chats'
import type { Workspaces } from './bots/workspaces'
import { boardLine } from './devices/origin-line'
import type { BotEngine } from './engines/bot-engine'
import type { HistoryStore } from './history/history-store'
import type { LibraryStore } from './library/library-store'
import type { RoutineStore } from './routines/routine-store'
import type { CallingChats } from './threads/calling-chats'
import type { ThreadStore } from './threads/thread-store'
import type { WebhookStore } from './webhooks/webhook-store'
import { WorkAnswers } from './work/work-answers'
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
  libraryStore: LibraryStore
  workspaces: Workspaces
  activity: ActivityService
  history: Pick<HistoryStore, 'reference'>
  calls: CallingChats
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
      const asker = threadStore.get(exchange).participants[0]
      return { origin: { kind: 'exchange', id: exchange }, askedBy: { kind: 'bot', id: asker.id, name: asker.name } }
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
  libraryStore,
  workspaces,
  activity,
  history,
  calls,
  publish
}: WorkDeps) {
  const work = new WorkService(new WorkStore(database), {
    requireBot: id => bots.requireBot(id),
    checkers: async () => (await bots.listBots()).filter(bot => bot.runnable || bot.runtimePending).map(({ id, name }) => ({ id, name })),
    callingChat: (botId, requestId) => calls.find(botId, requestId),
    session: workSessions(threadStore, routineStore, webhookStore, rootOf),
    libraryTitle: (botId, itemId) => libraryStore.get(botId, itemId)?.title ?? null,
    waiting: (botId, itemId, key, on) => {
      if (store.exists(botId)) activity.observe({ botId, chatId: `work:${itemId}`, key, status: on ? 'waiting' : 'finished' })
    },
    line: item => {
      if (item.chatId && store.exists(item.ownerId)) history.reference(item.ownerId, item.chatId, workLine(item), item.createdAt)
    },
    tell: (id, item, prompt) => answers.queue(id, item, prompt),
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
    (botId, prompt, runId, onChat) => bots.runRoutine(botId, prompt, { runId, hiddenInput: true, onChat, origin: { line: boardLine } }),
    (botId, checkId, working) => {
      if (store.exists(botId)) activity.observe({ botId, chatId: `check:${checkId}`, key: `${checkId}:${working}:${Date.now()}`, status: working ? 'working' : 'finished' })
    },
    botId => workspaces.pathFor(botId)
  )
  return { work, answers, checks, links: new WorkLinks(work, answers) }
}
