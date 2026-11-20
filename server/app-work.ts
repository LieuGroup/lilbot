/** Builds the work board and connects it to the bots, exchanges, routine runs, activity, history and browsers. */
import type { Database } from 'bun:sqlite'
import type { ChatItem } from '../shared/chat-schema'
import type { EventFrame } from '../shared/protocol'
import type { ActivityService } from './activity/activity-service'
import type { BotPrefsStore } from './bots/bot-prefs-store'
import type { BotService } from './bots/bot-service'
import type { BotStore } from './bots/bot-store'
import { boardLine } from './devices/origin-line'
import type { HistoryStore } from './history/history-store'
import type { LibraryStore } from './library/library-store'
import type { RoutineStore } from './routines/routine-store'
import type { CallingChats } from './threads/calling-chats'
import type { ThreadStore } from './threads/thread-store'
import { WorkAnswers } from './work/work-answers'
import { WorkBoard } from './work/work-board'
import { WorkLinks } from './work/work-links'
import { type SessionOrigin, WorkService } from './work/work-service'
import { type StoredItem, WorkStore } from './work/work-store'

interface WorkDeps {
  database: Database
  store: BotStore
  prefs: BotPrefsStore
  bots: BotService
  threadStore: ThreadStore
  routineStore: RoutineStore
  libraryStore: LibraryStore
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

/** Where a bot's session came from: an exchange's hidden session, a routine run's session, or else a conversation. */
export function workSessions(threadStore: ThreadStore, routineStore: RoutineStore) {
  return (botId: string, chatId: string): SessionOrigin => {
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
    return { origin: { kind: 'conversation', id: chatId }, askedBy: null }
  }
}

export function createWork({ database, store, prefs, bots, threadStore, routineStore, libraryStore, activity, history, calls, publish }: WorkDeps) {
  const work = new WorkService(new WorkStore(database), {
    requireBot: id => bots.requireBot(id),
    callingChat: (botId, requestId) => calls.find(botId, requestId),
    session: workSessions(threadStore, routineStore),
    libraryTitle: (botId, itemId) => libraryStore.get(botId, itemId)?.title ?? null,
    waiting: (botId, itemId, key, on) => {
      if (store.exists(botId)) activity.observe({ botId, chatId: `work:${itemId}`, key, status: on ? 'waiting' : 'finished' })
    },
    line: item => {
      if (item.chatId && store.exists(item.ownerId)) history.reference(item.ownerId, item.chatId, workLine(item), item.createdAt)
    },
    changed: () => publish({ event: 'work.changed' })
  })
  const answers = new WorkAnswers(database, (botId, prompt, runId, chatId) =>
    bots.runRoutine(botId, prompt, { runId, chatId: chatId ?? prefs.mainChat(botId) ?? undefined, hiddenInput: true, onChat: () => {}, origin: { line: boardLine } })
  )
  return { work, answers, board: new WorkBoard(work, answers), links: new WorkLinks(work, answers) }
}
