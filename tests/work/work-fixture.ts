/** The real work board over an in-memory database, with the real session resolver over real thread, routine and
 *  webhook stores. The calling chat, Library titles and the host's side effects are recorded for the tests to read. */
import type { Database } from 'bun:sqlite'
import { workSessions } from '../../server/app-work'
import { openDatabase } from '../../server/database/database'
import { requireAgreed } from '../../server/goals/goal-rules'
import { GoalStore } from '../../server/goals/goal-store'
import { RoutineStore } from '../../server/routines/routine-store'
import { type CallingChats, NOT_SEEN } from '../../server/threads/calling-chats'
import { ThreadStore } from '../../server/threads/thread-store'
import { WebhookStore } from '../../server/webhooks/webhook-store'
import { WorkAnswers } from '../../server/work/work-answers'
import { WorkBoard } from '../../server/work/work-board'
import { WorkCheckRunner } from '../../server/work/work-check-runner'
import { WorkLinks } from '../../server/work/work-links'
import { WorkService } from '../../server/work/work-service'
import { type StoredItem, WorkStore } from '../../server/work/work-store'
import type { BotModel } from '../../shared/bot-schema'
import { LilBotError } from '../../shared/protocol'

type Bot = { id: string; name: string }
const BOTS: Bot[] = ['a', 'b', 'c'].map(id => ({ id, name: id.toUpperCase() }))

/** The exchanges between bots, for the tests that join them (`new WorkBoard(w.work, w.answers, d.threads)`); alone, an exchange refuses. */
const noExchanges = {
  oscarAnswer() {
    throw new LilBotError('thread_missing', 'No exchanges here.')
  },
  dropped: () => async () => {}
}

/** `calls` matches each call to the tool starts reported to it, as the server does; without it `state.chats` says. */
export function workFixture(options: { database?: Database; requireBot?: (id: string) => Promise<Bot>; calls?: CallingChats } = {}) {
  const database = options.database ?? openDatabase(':memory:')
  const state = {
    /** The session each bot's next call comes from; by default its main conversation (null: no tool start was seen). */
    chats: new Map<string, string | null>(),
    /** Compression continuations: a session id to the one it began as (null: the lineage cannot be read). */
    roots: new Map<string, string | null>(),
    library: new Map<string, string>(),
    waits: [] as { botId: string; itemId: string; key: string; on: boolean }[],
    lines: [] as StoredItem[],
    pushes: 0,
    /** The bots that could check an item now. */
    checkers: BOTS,
    /** The different model a same-bot check runs on (null: the bot's own). */
    checkModel: null as BotModel | null,
    /** Check runs started: the checking bot, its prompt, run id and model. `finish` settles the next one. */
    runs: [] as { botId: string; prompt: string; runId: string; model?: BotModel }[],
    activity: [] as [string, boolean][]
  }
  const threadStore = new ThreadStore(database)
  const routineStore = new RoutineStore(database)
  const webhookStore = new WebhookStore(database)
  const goalStore = new GoalStore(database)
  const work = new WorkService(new WorkStore(database), {
    requireBot:
      options.requireBot ??
      (async id => {
        const bot = BOTS.find(b => b.id === id)
        if (!bot) throw new LilBotError('bot_not_found', 'That bot does not exist.')
        return bot
      }),
    checkers: async () => state.checkers,
    checkModel: async () => state.checkModel,
    callingChat: async (botId, tool, requestId) => {
      if (options.calls) return options.calls.find(botId, tool, requestId)
      const chat = state.chats.has(botId) ? state.chats.get(botId) : `${botId}-main`
      if (!chat) throw new LilBotError('session_unknown', NOT_SEEN)
      return chat
    },
    session: workSessions(threadStore, routineStore, webhookStore, (_bot, chat) => (state.roots.has(chat) ? state.roots.get(chat)! : chat)),
    libraryTitle: (botId, itemId) => state.library.get(`${botId}:${itemId}`) ?? null,
    checkGoal: (botId, goalId) => requireAgreed(goalStore.get(goalId), botId),
    waiting: (botId, itemId, key, on) => state.waits.push({ botId, itemId, key, on }),
    line: item => state.lines.push(item),
    tell: (id, item, prompt) => answers.queue(id, item, prompt),
    changed: () => state.pushes++
  })
  const delivered: { botId: string; prompt: string; runId: string; chatId: string | null }[] = []
  const interrupted: { botId: string; chatId: string | null }[] = []
  /** `interrupt` and `deliver`, in the order they happened. */
  const order: string[] = []
  const deliver = { fail: null as Error | null }
  const answers = new WorkAnswers(
    database,
    async (botId, prompt, runId, chatId) => {
      if (deliver.fail) throw deliver.fail
      order.push('deliver')
      delivered.push({ botId, prompt, runId, chatId })
    },
    async (botId, chatId) => {
      order.push('interrupt')
      interrupted.push({ botId, chatId })
    }
  )
  const links = new WorkLinks(work, answers)
  const run = { result: Promise.resolve({ status: 'completed' }) as Promise<{ status: string }> }
  const checkRuns = new WorkCheckRunner(
    work,
    async (botId, prompt, runId, onChat, model) => {
      state.runs.push({ botId, prompt, runId, model })
      onChat(`${runId}-session`)
      return run.result
    },
    (botId, _checkId, working) => state.activity.push([botId, working]),
    botId => `/workspaces/${botId}`
  )
  /** Opens an item for `botId` with a definition, as a bot would. */
  const open = (botId: string, extra: Record<string, unknown> = {}) =>
    work.act(botId, { requestId: crypto.randomUUID(), title: 'Write the report', kind: 'file', done: 'report.md lists every month', ...extra })
  return {
    database,
    state,
    work,
    answers,
    delivered,
    interrupted,
    order,
    deliver,
    board: new WorkBoard(work, answers, noExchanges),
    links,
    checkRuns,
    run,
    threadStore,
    routineStore,
    webhookStore,
    goalStore,
    open
  }
}
