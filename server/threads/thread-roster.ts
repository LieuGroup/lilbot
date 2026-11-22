/** What the roster shows of each bot's work with other bots and its own workers: running groups (and what it does there),
 *  whose task it works on now, and how many of its own workers are running. */
import type { BotGroup, BotWorkers, BotWorkingFor } from '../../shared/bot-schema'
import type { GroupStore } from './group-store'
import { rosterGroups } from './group-view'
import type { ThreadRunner } from './thread-runner'
import type { ThreadStore } from './thread-store'

export function botRoster(store: ThreadStore, groups: GroupStore | undefined, runner: ThreadRunner) {
  const out = new Map<string, { groups?: BotGroup[]; workingFor?: BotWorkingFor; workers?: BotWorkers }>()
  if (groups) for (const [botId, list] of rosterGroups(store, groups, runner)) out.set(botId, { groups: list })
  const workers = new Map<string, BotWorkers>()
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
    out.set(d.target, { ...out.get(d.target), workingFor: { threadId: thread.id, name: thread.participants[0].name } })
  }
  for (const [botId, entry] of workers) out.set(botId, { ...out.get(botId), workers: entry })
  return out
}
