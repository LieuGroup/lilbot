/** The Memory page's sentences, the same on the web and the phone. Pure, so wording and plurals are tested. */
import type { MemoryFact } from '../../memory-schema'

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
export const factCount = (n: number) => count(n, 'fact', 'facts')
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const shortDay = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

export const MEMORY_TITLES = {
  shared: 'Shared with all your bots',
  oneBot: 'Known by one bot only',
  removed: 'Removed facts',
  lasting: 'Lasting facts',
  history: 'History',
  empty: 'Nothing remembered yet',
  emptyHint: 'When a bot learns something worth keeping, it shows up here. You can also add a fact yourself.',
  removedHint: 'Bots no longer see these. Restore one to bring it back.',
  actionsHint: 'Pause keeps the fact but bots stop seeing it. Forget moves it to Removed facts, where you can restore it.'
} as const

/** Whether bots stop seeing it on their own: paused, or past its end date. */
function factState(fact: MemoryFact, now: number): 'on' | 'paused' | 'ended' {
  if (fact.paused) return 'paused'
  return fact.expiresAt !== null && fact.expiresAt <= now ? 'ended' : 'on'
}

/** Muted word at the end of a one-line row; nothing for an ordinary fact. */
export function rowNote(fact: MemoryFact, now: number): string {
  const state = factState(fact, now)
  return state === 'paused' ? 'Paused' : state === 'ended' ? 'Ended' : ''
}

/** How it got into memory and when: "Learned by Chief in a chat · 20 Nov 2026". */
export function originLine(fact: MemoryFact, botName: string): string {
  const how =
    fact.author === 'user'
      ? 'Added by you'
      : fact.via === 'review'
        ? `Found by ${botName} when reviewing a chat`
        : fact.via === 'import'
          ? `Brought over from ${botName}’s earlier notes`
          : `Learned by ${botName} in a chat`
  return `${how} · ${day(fact.learnedAt)}`
}

/** Who sees it, and why it may be hidden from bots right now. */
export function seenLine(fact: MemoryFact, botName: string, now: number): string {
  const who = fact.scope === 'shared' ? 'Every bot sees this' : `Only ${botName} sees this`
  const state = factState(fact, now)
  if (state === 'paused') return `Paused: ${fact.scope === 'shared' ? 'no bot sees' : `${botName} does not see`} it for now`
  if (state === 'ended') return `Ended ${day(fact.expiresAt ?? now)}: bots no longer see it`
  return fact.expiresAt !== null ? `${who} until ${day(fact.expiresAt)}` : who
}

/** Under a removed fact: who removed it and when. */
export function removedLine(fact: MemoryFact, botName: string): string {
  const who = fact.forgottenBy === 'bot' ? `Removed by ${botName}` : 'Removed by you'
  return fact.forgottenAt === null ? who : `${who} · ${shortDay(fact.forgottenAt)}`
}

export const removedLink = (n: number) => count(n, 'removed fact', 'removed facts')
export const moreLine = (n: number) => `Show ${n} more`
export const matchLine = (n: number, more: boolean) => (n === 0 ? 'No fact matches' : `${more ? `${n}+` : n} ${n === 1 ? 'fact matches' : 'facts match'}`)
export const botHint = (name: string) => `Known only by ${name}. Other bots never see these.`

/** Bots that still use their engine's own notes and do not read this memory. */
export function notConnectedLine(names: string[]): string {
  const list = names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  return `${list} still ${names.length === 1 ? 'uses its' : 'use their'} engine’s own notes, so ${names.length === 1 ? 'it does' : 'they do'} not read this memory.`
}
