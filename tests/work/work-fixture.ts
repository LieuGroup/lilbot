/** The real work board over an in-memory database, with the real session resolver over real thread, routine and
 *  webhook stores. The calling chat, Library titles and the host's side effects are recorded for the tests to read. */
import type { Database } from 'bun:sqlite'
import { workSessions } from '../../server/app-work'
import { openDatabase } from '../../server/database/database'
import { RoutineStore } from '../../server/routines/routine-store'
import { ThreadStore } from '../../server/threads/thread-store'
import { WebhookStore } from '../../server/webhooks/webhook-store'
import { WorkAnswers } from '../../server/work/work-answers'
import { WorkBoard } from '../../server/work/work-board'
import { WorkLinks } from '../../server/work/work-links'
import { WorkService } from '../../server/work/work-service'
import { type StoredItem, WorkStore } from '../../server/work/work-store'
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

export function workFixture(options: { database?: Database; requireBot?: (id: string) => Promise<Bot> } = {}) {
  const database = options.database ?? openDatabase(':memory:')
  const state = {
    /** The session each bot's next call comes from; by default its main conversation. */
    chats: new Map<string, string | null>(),
    /** Compression continuations: a session id to the one it began as (null: the lineage cannot be read). */
    roots: new Map<string, string | null>(),
    library: new Map<string, string>(),
    waits: [] as { botId: string; itemId: string; key: string; on: boolean }[],
    lines: [] as StoredItem[],
    pushes: 0
  }
  const threadStore = new ThreadStore(database)
  const routineStore = new RoutineStore(database)
  const webhookStore = new WebhookStore(database)
  const work = new WorkService(new WorkStore(database), {
    requireBot:
      options.requireBot ??
      (async id => {
        const bot = BOTS.find(b => b.id === id)
        if (!bot) throw new LilBotError('bot_not_found', 'That bot does not exist.')
        return bot
      }),
    callingChat: async botId => (state.chats.has(botId) ? state.chats.get(botId)! : `${botId}-main`),
    session: workSessions(threadStore, routineStore, webhookStore, (_bot, chat) => (state.roots.has(chat) ? state.roots.get(chat)! : chat)),
    libraryTitle: (botId, itemId) => state.library.get(`${botId}:${itemId}`) ?? null,
    waiting: (botId, itemId, key, on) => state.waits.push({ botId, itemId, key, on }),
    line: item => state.lines.push(item),
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
  /** Opens an item for `botId` with a definition, as a bot would. */
  const open = (botId: string, extra: Record<string, unknown> = {}) =>
    work.act(botId, { requestId: crypto.randomUUID(), title: 'Write the report', done: 'report.md lists every month', ...extra })
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
    threadStore,
    routineStore,
    webhookStore,
    open
  }
}
