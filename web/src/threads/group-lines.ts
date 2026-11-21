/** What a temporary group's line, view, roster row and Activity row say (#136), from `threads.list` and `bots.list`. Pure:
 *  `now` is passed in so run times keep counting. Every wording is LilBot's own, built from how the group ended and its
 *  counts, never the server's outcome text for an end that was not a close. */
import type { Bot } from '../../../shared/bot-schema'
import type { BotThread, GroupEnd, ThreadGroup } from '../../../shared/thread-schema'
import { type LineState, plural, runTime, shortDate } from './thread-lines'

export type GroupThread = BotThread & { group: ThreadGroup }

export const isGroup = (thread: BotThread): thread is GroupThread => thread.group !== undefined
export const leaderOf = (thread: BotThread) => thread.participants[0]
/** "FillLight" for "FillLight Bot": the chips and the round dividers. */
export const shortName = (name: string) => name.trim().split(/\s+/)[0] || name

const LIMITS: Record<Exclude<GroupEnd, 'closed' | 'stopped'>, (g: ThreadGroup) => string> = {
  rounds: g => `reached the ${g.roundCap}-round limit`,
  messages: () => 'reached the message limit',
  time: () => 'reached the time limit',
  quiet: () => 'went quiet',
  failed: () => 'its leader could not be reached'
}

/** "Stopped by you · round 2", "Ended by itself · went quiet"; null for a close and while it runs. */
function endedLine(g: ThreadGroup) {
  if (!g.end || g.end.how === 'closed') return null
  return g.end.how === 'stopped' ? `Stopped by you · round ${g.rounds.length}` : `Ended by itself · ${LIMITS[g.end.how](g)}`
}

/** "3 rounds, 14 turns, 11 min" (or with dots in the outcome card). */
function totals(thread: GroupThread, now: number, separator = ', ') {
  return [plural(thread.group.rounds.length, 'round'), plural(thread.group.turns, 'turn'), runTime(thread, now)].join(separator)
}

/** The bold line in a conversation: the leader's "Group · <purpose>", a member's "In <leader>'s group · <purpose>". */
export function groupTitle(thread: GroupThread, botId: string) {
  const leader = leaderOf(thread)
  return leader.id === botId ? `Group · ${thread.group.purpose}` : `In ${leader.name}'s group · ${thread.group.purpose}`
}

/** The 12px state line under it: rounds and replies while it runs, then how it ended. */
export function groupState(thread: GroupThread, now: number): LineState {
  const g = thread.group
  const plain = { failed: false, stopped: false }
  if (!g.end) {
    const round = g.rounds.at(-1)
    if (!round) return { ...plain, icon: 'working', text: 'Starting' }
    return { ...plain, icon: 'working', text: `Round ${round.n} · ${round.replied?.length ?? 0} of ${round.to.length} have replied` }
  }
  const ended = endedLine(g)
  if (ended) return { icon: null, text: ended, failed: false, stopped: true }
  return { ...plain, icon: null, text: `Closed · ${totals(thread, now)} · outcome inside` }
}

/** The line under the view's title: "Temporary group · led by X", then "Group closed today 10:21 · led by X". */
export function groupSubtitle(thread: GroupThread, now: number) {
  const g = thread.group
  const led = `led by ${leaderOf(thread).name}`
  if (!g.end) return `Temporary group · ${led}`
  const verb = g.end.how === 'closed' ? 'closed' : g.end.how === 'stopped' ? 'stopped' : 'ended'
  return `Group ${verb} ${shortDate(g.end.at, now)
    .replace(/^Today/, 'today')
    .replace(/^Yesterday/, 'yesterday')} · ${led}`
}

/** The card on top of an ended group: its outcome, or why it ended in place of one. */
export function outcomeCard(thread: GroupThread, now: number) {
  const g = thread.group
  const end = g.end!
  const stats = totals(thread, now, ' · ')
  if (end.how === 'closed') return { title: 'Outcome', stats, text: end.outcome }
  if (end.how === 'stopped') return { title: 'Stopped by you', stats, text: `You stopped this group in round ${g.rounds.length}, before the leader closed it.` }
  const why = LIMITS[end.how](g)
  return { title: 'Ended by itself', stats, text: `It ${why} before the leader closed it.` }
}

/** "A and B", "A, B and C". */
const listed = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

/** The centred divider that opens a round: "Round 2 · to Footy and HeardBack · 10:14" (the time is passed in). */
export function roundLabel(thread: GroupThread, round: ThreadGroup['rounds'][number], time: string) {
  const members = thread.participants.slice(1)
  const everyone = members.every(member => round.to.includes(member.id))
  const names = members.filter(member => round.to.includes(member.id)).map(member => shortName(member.name))
  return `Round ${round.n} · ${everyone ? 'to everyone' : `to ${listed(names)}`} · ${time}`
}

/** The members still part of the current round, and the leader once it is at work on the replies: who replied, who works on
 *  what, who has not started. Nothing once the group ended. */
export function pendingReplies(thread: GroupThread) {
  const g = thread.group
  const round = g.rounds.at(-1)
  if (g.end || !round) return []
  return (g.members ?? []).flatMap((member): { id: string; name: string; text: string; tone: 'finished' | 'working' | null }[] => {
    const addressed = round.to.includes(member.id)
    if (!addressed && member.state !== 'working') return []
    const name = thread.participants.find(p => p.id === member.id)?.name ?? 'A bot'
    if (member.state === 'replied') return [{ id: member.id, name, text: `${name} replied`, tone: 'finished' }]
    if (member.state === 'working') return [{ id: member.id, name, text: `${name} · ${member.activity || 'Working'}`, tone: 'working' }]
    return [{ id: member.id, name, text: `${name} · Waiting to start`, tone: null }]
  })
}

/** One row of the Activity tab's "With other bots" card. */
export function groupActivityRow(thread: GroupThread, now: number) {
  const g = thread.group
  const title = `Group · ${g.purpose}`
  if (!g.end) return { title, line: `Running · round ${g.rounds.length} · ${plural(thread.participants.length, 'bot')}` }
  const how = g.end.how === 'closed' ? 'closed with an outcome' : g.end.how === 'stopped' ? 'stopped by you' : `ended by itself · ${LIMITS[g.end.how](g)}`
  return { title, line: `${shortDate(thread.createdAt, now)} · ${how}` }
}

const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five']
/** The stop dialog's sentence before the shared rest: "All four bots stop working on it now." */
export const stopSentence = (thread: BotThread) => `All ${NUMBERS[thread.participants.length] ?? thread.participants.length} bots stop working on it now.`

export interface RunningGroup {
  id: string
  purpose: string
  round: number
  /** The leader first, then the members in roster order. */
  bots: Bot[]
}

/** The roster's "Working together" rows: every running group in `bots.list`, with its bots gathered from each bot's `groups`. */
export function runningGroups(bots: Bot[]): RunningGroup[] {
  const byId = new Map<string, RunningGroup>()
  for (const bot of bots)
    for (const group of bot.groups ?? []) {
      const entry = byId.get(group.id) ?? { id: group.id, purpose: group.purpose, round: group.round, bots: [] }
      if (group.leading) entry.bots.unshift(bot)
      else entry.bots.push(bot)
      byId.set(group.id, entry)
    }
  return [...byId.values()]
}
