/** What the roster shows of each bot's work with other bots and its own workers: running groups (and what it does there),
 *  every task it works on now for other bots, and how many of its own workers are running. */
import type { BotGroup, BotTaskFor, BotWorkers, BotWorkingFor } from '../../shared/bot-schema'
import type { GroupStore } from './group-store'
import { rosterGroups } from './group-view'
import type { ThreadRunner } from './thread-runner'
import { type Delivery, isWork, type ThreadStore } from './thread-store'

type RosterEntry = { groups?: BotGroup[]; workingFor?: BotWorkingFor; tasksFor?: BotTaskFor[]; workers?: BotWorkers }

/** True when `d` is a non-cancelled same-bot worker delivery and the bot's sole active worker (so its tool line appears on the roster). */
export function isSoleRunningWorker(store: ThreadStore, running: Iterable<Delivery>, d: Delivery) {
  if (!isWork(d.kind)) return false
  const thread = store.get(d.threadId)
  if (!thread.worker || thread.status === 'cancelled') return false
  let count = 0
  for (const r of running) {
    if (!isWork(r.kind) || r.target !== d.target) continue
    const other = store.get(r.threadId)
    if (other.worker && other.status !== 'cancelled' && ++count > 1) return false
  }
  return count === 1
}

export function botRoster(store: ThreadStore, groups: GroupStore | undefined, runner: ThreadRunner) {
  const out = new Map<string, RosterEntry>()
  if (groups) for (const [botId, list] of rosterGroups(store, groups, runner)) out.set(botId, { groups: list })
  const workers = new Map<string, BotWorkers>()
  const received = new Map<string, Map<string, BotTaskFor & { startedAt: number }>>()
  for (const d of runner.running.values()) {
    // A receiver's turn on a task it was handed; answers and notices run in the delegating bot's own sessions.
    if (d.kind !== 'request' && d.kind !== 'redirect' && d.kind !== 'oscar') continue
    const thread = store.get(d.threadId)
    if (thread.group || thread.status === 'cancelled') continue
    if (thread.worker) {
      const entry = workers.get(d.target) ?? { count: 0 }
      entry.count += 1
      if (entry.count === 1) {
        const line = runner.lineOf(d)
        if (line) entry.activity = line
      } else delete entry.activity
      workers.set(d.target, entry)
      continue
    }
    if (thread.participants[1].id !== d.target) continue
    // One entry per exchange, however many of its deliveries run at once.
    const tasks = received.get(d.target) ?? new Map()
    const from = thread.participants[0]
    tasks.set(thread.id, { threadId: thread.id, botId: from.id, name: from.name, startedAt: thread.startedAt ?? thread.createdAt })
    received.set(d.target, tasks)
  }
  for (const [botId, tasks] of received) {
    const tasksFor = [...tasks.values()].sort((a, b) => a.startedAt - b.startedAt || a.threadId.localeCompare(b.threadId)).map(({ startedAt: _, ...task }) => task)
    const first = tasksFor[0]
    out.set(botId, { ...out.get(botId), workingFor: { threadId: first.threadId, name: first.name }, tasksFor })
  }
  for (const [botId, entry] of workers) out.set(botId, { ...out.get(botId), workers: entry })
  return out
}
