/** Real thread services over an in-memory database and a temporary workspaces folder, with an engine whose runs
 *  stay open until the test finishes them, so status, stop and redirect can be seen mid-run. Groups run too: journal
 *  entries and Library gifts are recorded for the tests to read. */
import type { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Workspaces } from '../../server/bots/workspaces'
import { openDatabase } from '../../server/database/database'
import type { RoutineOptions } from '../../server/engines/bot-engine'
import type { CallingChats } from '../../server/threads/calling-chats'
import { DelegationControl } from '../../server/threads/delegation-control'
import { DelegationService, type DelegationWork } from '../../server/threads/delegation-service'
import type { GroupHost, GroupWork } from '../../server/threads/group-end'
import type { GroupLimits } from '../../server/threads/thread-limits'
import { ThreadService } from '../../server/threads/thread-service'
import { type Delivery, ThreadStore } from '../../server/threads/thread-store'
import type { ChatItem } from '../../shared/chat-schema'
import { LilBotError } from '../../shared/lilbot-error'
import { until } from '../helpers/until'

type Result = { status: string; text: string; items?: ChatItem[]; unknownReceipt?: true }
interface Run {
  botId: string
  prompt: string
  options: RoutineOptions
  chatId: string
  finished: boolean
  finish(text?: string, before?: ChatItem[], status?: string, extra?: Partial<Result>): void
}

const roots: string[] = []
/** Each test file removes the folders its fixtures made: `afterAll(removeFixtureFolders)`. */
export function removeFixtureFolders() {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
}

/** A group host over a workspaces folder: memory refuses journal entries `refuse` matches; `chats` says which session a
 *  bot's next call comes from (its main conversation by default). */
export function groupHostFor(root: string, work?: GroupWork, refuse: (text: string) => boolean = () => false) {
  const chats = new Map<string, string>()
  const journal: { botId: string; text: string; chatId: string | null }[] = []
  const given: { botId: string; path: string; title: string; chatId: string }[] = []
  const pushes = { roster: 0 }
  const host: GroupHost = {
    root,
    journal: (botId, text, chatId) => {
      if (refuse(text)) throw new LilBotError('fact_refused', 'That fact cannot be saved.')
      journal.push({ botId, text, chatId })
    },
    give: async (botId, path, title, chatId) => {
      given.push({ botId, path, title, chatId })
    },
    callingChat: async botId => chats.get(botId) ?? `${botId}-main`,
    rootOf: (_botId, chatId) => chatId,
    work,
    rosterChanged: () => pushes.roster++
  }
  return { host, chats, journal, given, pushes }
}

/** `database` and `work` join it to a work board; `changed` hears every exchange change; `limits` and `refuse` shape groups;
 *  `calls` matches each call to the tool starts reported to it, as the server does. */
export function delegationFixture(
  options: {
    database?: Database
    work?: DelegationWork & GroupWork
    changed?: () => void
    activity?: (botId: string, d: Delivery, working: boolean) => void
    touched?: (roster?: boolean) => void
    limits?: GroupLimits
    refuse?: (text: string) => boolean
    calls?: CallingChats
  } = {}
) {
  const root = mkdtempSync(join(tmpdir(), 'lilbot-delegation-'))
  roots.push(root)
  const workspaces = new Workspaces(root)
  const store = new ThreadStore(options.database ?? openDatabase(':memory:'))
  const bots = ['a', 'b', 'c', 'd'].map(id => ({ id, name: id.toUpperCase() }))
  const runs: Run[] = []
  const stops: string[] = []
  const steers: { chatId: string; text: string }[] = []
  const host = {
    requireBot: async (id: string) => {
      const bot = bots.find(b => b.id === id)
      if (!bot) throw new LilBotError('bot_not_found', 'That bot does not exist.')
      return bot
    },
    listBots: async () => bots,
    folder: (id: string) => workspaces.ensure(id),
    runRoutine: (botId: string, prompt: string, options: RoutineOptions) =>
      new Promise<Result>(resolve => {
        const chatId = options.chatId ?? `${botId}-hidden-${runs.length}`
        options.onChat(chatId)
        const run: Run = {
          botId,
          prompt,
          options,
          chatId,
          finished: false,
          finish: (text = 'done', before = [], status = 'completed', extra = {}) => {
            run.finished = true
            resolve({ status, text, items: [...before, { kind: 'assistant', text }], ...extra })
          }
        }
        runs.push(run)
      }),
    stopRun: async (_botId: string, chatId: string) => {
      stops.push(chatId)
      return true
    },
    steerRun: async (_botId: string, chatId: string, text: string) => {
      steers.push({ chatId, text })
      return 'steered' as const
    }
  }
  const group = groupHostFor(root, options.work, options.refuse)
  const { calls } = options
  if (calls) group.host.callingChat = (botId, requestId) => calls.find(botId, 'lilbot_group', requestId)
  const threads = new ThreadService(store, host, options.changed, options.activity, options.touched, group.host, options.limits)
  const hand = new DelegationService(
    threads,
    host,
    (botId, requestId) => (calls ? calls.find(botId, 'lilbot_delegate', requestId) : group.host.callingChat(botId, '')),
    options.work
  )
  const control = new DelegationControl(threads, host)
  const delegation = {
    delegate: hand.delegate.bind(hand),
    attach: hand.attach.bind(hand),
    status: control.status.bind(control),
    cancel: control.cancel.bind(control),
    redirect: control.redirect.bind(control),
    wait: control.wait.bind(control)
  }
  /** One tick, then waits until each delivery in flight has finished or waits in a run the test has not finished: the work LilBot
   *  does between runs (preparing a prompt, copying files, recording a reply) is done. A reply that work queues starts on the next. */
  const settle = async () => {
    threads.tick()
    const inFlight = [...threads.runner.running.values()]
    const parked = (d: Delivery) => runs.some(run => run.options.runId === `thread-${d.id}` && !run.finished)
    await until(() => inFlight.every(d => !threads.runner.running.has(d.id) || parked(d)))
  }
  const groups = threads.groups!
  /** Deletes a bot from the fixture's engine. */
  const remove = (id: string) =>
    bots.splice(
      bots.findIndex(b => b.id === id),
      1
    )
  return { root, store, threads, delegation, groups, group, runs, stops, steers, settle, remove, path: (bot: string, file: string) => join(root, bot, file) }
}
