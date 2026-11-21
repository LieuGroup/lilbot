/** What is read of a temporary group: Oscar's view (members' states, who has replied to each round), the bots' status,
 *  and the running groups the roster shows. All of it is worked out from the stored record and the outbox. */
import { join } from 'node:path'
import type { BotGroup } from '../../shared/bot-schema'
import type { BotThread, GroupMember, ThreadGroup } from '../../shared/thread-schema'
import { fenced } from '../memory/memory-safety'
import { said } from './group-prompts'
import { type GroupStore, roundOf } from './group-store'
import type { ThreadRunner } from './thread-runner'
import type { ThreadStore } from './thread-store'

export function groupView(thread: BotThread, groups: GroupStore, runner: ThreadRunner): ThreadGroup {
  const g = thread.group!
  const points = groups.points(thread.id)
  const running = runner.runningIn(thread.id)
  const replied = (n: number) => points.filter(p => roundOf(p) === n && p.status === 'done').map(p => p.target)
  const current = g.rounds.at(-1)
  const members = thread.participants.map((p): GroupMember => {
    const run = running.find(d => d.target === p.id)
    const state = run ? 'working' : g.end || !current?.to.includes(p.id) ? 'idle' : replied(current.n).includes(p.id) ? 'replied' : 'waiting'
    return { id: p.id, state, activity: run ? runner.lineOf(run) : null }
  })
  return { ...g, rounds: g.rounds.map(r => ({ ...r, replied: replied(r.n) })), members }
}

/** What a bot in the group reads with the status action: other bots' words fenced, files where they are. */
export function botStatus(view: BotThread) {
  const g = view.group!
  const name = (id: string) => view.participants.find(p => p.id === id)?.name ?? 'a bot'
  return {
    groupId: view.id,
    purpose: g.purpose,
    leader: view.participants[0].name,
    members: g.members?.map(m => ({ name: name(m.id), state: m.state, activity: m.activity })),
    round: g.rounds.length,
    roundCap: g.roundCap,
    turns: g.turns,
    state: g.end?.how ?? 'running',
    ...(g.end ? { outcome: fenced('group-outcome', g.end.outcome) } : {}),
    folder: g.folder,
    kept: g.kept.map(f => f.path),
    messages: view.messages.slice(-30).map(m => ({
      from: m.authorName,
      ...(m.round ? { round: m.round } : {}),
      ...(m.withheld ? { withheld: true } : {}),
      text: said(m, 2000),
      tools: m.items.flatMap(i => (i.kind === 'tool' ? [`${i.name} ${i.detail}`.slice(0, 200)] : [])),
      files: (m.files ?? []).map(f => (f.path ? join(g.folder, f.path) : `${JSON.stringify(f.name)} (not delivered)`))
    })),
    note: g.end ? 'This group has ended; it is read-only.' : 'Replies come back as new turns: never poll.'
  }
}

/** Running groups by bot, for the roster: each bot's groups, whether it leads them and, while its turn there runs, what it is doing. */
export function rosterGroups(store: ThreadStore, groups: GroupStore, runner: ThreadRunner) {
  const out = new Map<string, BotGroup[]>()
  for (const row of groups.running()) {
    const g = store.get(row.thread_id).group!
    const running = runner.runningIn(row.thread_id)
    for (const p of store.get(row.thread_id).participants) {
      const line = runner.lineOf(running.find(d => d.target === p.id))
      const group = { id: row.thread_id, purpose: g.purpose, round: g.rounds.length, roundCap: g.roundCap, leading: p.id === row.leader_id, ...(line ? { activity: line } : {}) }
      out.set(p.id, [...(out.get(p.id) ?? []), group])
    }
  }
  return out
}
