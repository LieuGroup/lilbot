/** What the roster shows of each bot's work with other bots: the running groups it is in, and whose task it works on now. */
import type { BotGroup, BotWorkingFor } from '../../shared/bot-schema'
import type { GroupStore } from './group-store'
import { rosterGroups } from './group-view'
import type { Delivery, ThreadStore } from './thread-store'

export function botRoster(store: ThreadStore, groups: GroupStore | undefined, running: Iterable<Delivery>) {
  const out = new Map<string, { groups?: BotGroup[]; workingFor?: BotWorkingFor }>()
  if (groups) for (const [botId, list] of rosterGroups(store, groups)) out.set(botId, { groups: list })
  for (const d of running) {
    // A receiver's turn on a task it was handed; answers and notices run in the delegating bot's own sessions.
    if (d.kind !== 'request' && d.kind !== 'redirect' && d.kind !== 'oscar') continue
    const thread = store.get(d.threadId)
    if (thread.group || thread.participants[1].id !== d.target) continue
    out.set(d.target, { ...out.get(d.target), workingFor: { threadId: thread.id, name: thread.participants[0].name } })
  }
  return out
}
