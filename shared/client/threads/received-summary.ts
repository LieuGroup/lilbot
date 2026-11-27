/** Dock header and collapsed-pill wording once a bot has tasks another bot handed it (Paper "26 Tasks a bot does for
 *  others", approved 2026-11-26, with the three build notes on #316). Both surfaces use the same words. Every task is
 *  counted once, so the numbers always add up to the rows in the dock. Pure. */

import type { DockItem } from './dock-items'
import type { LineState } from './thread-lines'
import { joined, sides } from './thread-lines'

export interface ReceivedSummary {
  icon: LineState['icon']
  /** Bold part of the pill; the header starts with it too. */
  lead: string
  /** Muted part after " · ". */
  detail: string
}

type Kind = DockItem['kind']

const count = (items: DockItem[], kind: Kind) => items.filter(item => item.kind === kind).length

/** "1 waiting for you", "2 running", "1 failed", "1 finished": only the non-zero ones, in the dock's order. */
function stateParts(items: DockItem[]) {
  const parts: string[] = []
  const words: [Kind, string][] = [
    ['waiting_oscar', 'waiting for you'],
    ['running', 'running'],
    ['failed', 'failed'],
    ['finished', 'finished']
  ]
  for (const [kind, word] of words) {
    const n = count(items, kind)
    if (n > 0) parts.push(`${n} ${word}`)
  }
  return parts
}

/** "for Chief of Staff" when one bot sent every received task, else "for 2 bots". */
function forWhom(received: DockItem[]) {
  const senders = new Map<string, string>()
  for (const item of received) senders.set(sides(item.thread).from.id, sides(item.thread).from.name)
  return senders.size === 1 ? `for ${[...senders.values()][0]}` : `for ${senders.size} bots`
}

/** The waiting bubble only while something waits for Oscar (the text then says so), the spinner only while something runs. */
function iconOf(items: DockItem[]): LineState['icon'] {
  if (count(items, 'waiting_oscar') > 0) return 'waiting'
  if (count(items, 'running') > 0) return 'working'
  return count(items, 'failed') > 0 ? 'failed' : 'finished'
}

const waitingNote = (items: DockItem[]) => {
  const n = count(items, 'waiting_oscar')
  return n > 0 ? ` (${n} waiting for you)` : ''
}

/** Received only: "2 running · for Chief of Staff", "1 waiting for you · 1 running · for 2 bots".
 *  Both kinds: "2 for Chief of Staff (1 waiting for you) · 1 handed out".
 *  `compact` (iPhone portrait) drops whom both kinds are for, keeping the counts: "1 waiting for you · 2 running". */
export function receivedSummary(items: DockItem[], compact = false): ReceivedSummary {
  const received = items.filter(item => item.received)
  const handed = items.filter(item => !item.received)
  const icon = iconOf(items)
  if (handed.length === 0) {
    const [lead, ...rest] = stateParts(received)
    return { icon, lead, detail: joined(...rest, forWhom(received)) }
  }
  if (compact) {
    const [lead, ...rest] = stateParts(items)
    return { icon, lead, detail: joined(...rest) }
  }
  return {
    icon,
    lead: `${received.length} ${forWhom(received)}${waitingNote(received)}`,
    detail: `${handed.length} handed out${waitingNote(handed)}`
  }
}

export interface DockSection {
  /** Shown only when the dock has both kinds: "For Chief of Staff" or "For 2 bots", then "Handed out". */
  label: string | null
  items: DockItem[]
}

/** Received tasks first, then this bot's own handed-out tasks and workers, each keeping the dock's order; one unlabelled
 *  section when only one kind is there, so a dock without received tasks looks exactly as before. */
export function dockSections(items: DockItem[]): DockSection[] {
  const received = items.filter(item => item.received)
  const handed = items.filter(item => !item.received)
  if (received.length === 0 || handed.length === 0) return [{ label: null, items }]
  const whom = forWhom(received)
  return [
    { label: `F${whom.slice(1)}`, items: received },
    { label: 'Handed out', items: handed }
  ]
}
