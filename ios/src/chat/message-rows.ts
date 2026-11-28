/** Pure FlatList row builder for the inverted transcript: emits StartMarker, DateLines, SessionDividers,
 *  messages (with inTurn / beforeTool flags for TurnActions, and queued for one still waiting for the bot) using invariant keys
 *  (`id:<historyId>` or `pos:<first+index>`) so prepending older history pages never shifts existing keys. */
import type { ChatView, MessageItem, ViewItem } from '../../../shared/client/chat/chat-state'
import { dayKey } from '../../../shared/client/history/history-labels'
import type { SessionReason } from '../../../shared/history-schema'

export type TranscriptRow =
  | { kind: 'message'; key: string; item: MessageItem; queued: boolean; inTurn: boolean; beforeTool: boolean }
  | { kind: 'date'; key: string; at: number }
  | { kind: 'session'; key: string; at: number; reason?: SessionReason; botName?: string }
  | { kind: 'start'; key: 'start'; at: number }

const timeOf = (item: ViewItem, fallbackNow: number) => item.at ?? fallbackNow

function startsDay(items: readonly ViewItem[], index: number, atStart: boolean, fallbackNow: number): boolean {
  const previous = items[index - 1]
  if (!previous) return atStart
  return dayKey(timeOf(previous, fallbackNow)) !== dayKey(timeOf(items[index], fallbackNow))
}

function newestSessionIndex(items: readonly ViewItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === 'session') return i
  }
  return -1
}

/** Builds inverted-order rows (index 0 is bottom/newest) from `ChatView`, mirroring web's `MessageRows`. */
export function buildTranscriptRows(view: Pick<ChatView, 'items' | 'queued' | 'first' | 'start' | 'running' | 'turnStart'>, botName: string, fallbackNow = Date.now()): TranscriptRow[] {
  const chronological: TranscriptRow[] = []
  const { items, queued, first, start, running, turnStart } = view
  const newestDivider = newestSessionIndex(items)

  if (start !== null) chronological.push({ kind: 'start', key: 'start', at: start })

  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    const position = first + index
    const stableId = item.id !== undefined ? `id:${item.id}` : `pos:${position}`
    if (item.kind === 'session') {
      chronological.push({
        kind: 'session',
        key: `session:${stableId}`,
        at: timeOf(item, fallbackNow),
        reason: item.reason,
        botName: index === newestDivider ? botName : undefined
      })
      continue
    }
    if (startsDay(items, index, start !== null, fallbackNow)) {
      chronological.push({ kind: 'date', key: `day:${stableId}`, at: timeOf(item, fallbackNow) })
    }
    const inTurn = running && turnStart !== null && index >= turnStart
    const beforeTool = items[index + 1]?.kind === 'tool'
    chronological.push({ kind: 'message', key: stableId, item, queued: item.kind === 'user' && queued.includes(item), inTurn, beforeTool })
  }

  return chronological.reverse()
}

/** Value-compares two TranscriptRows so streaming `text.delta` re-renders only the active row. */
export function sameTranscriptRow(a: TranscriptRow, b: TranscriptRow): boolean {
  if (a === b) return true
  if (a.kind !== b.kind || a.key !== b.key) return false
  if (a.kind === 'message' && b.kind === 'message') {
    return a.item === b.item && a.queued === b.queued && a.inTurn === b.inTurn && a.beforeTool === b.beforeTool
  }
  if (a.kind === 'session' && b.kind === 'session') {
    return a.at === b.at && a.reason === b.reason && a.botName === b.botName
  }
  if ((a.kind === 'date' && b.kind === 'date') || (a.kind === 'start' && b.kind === 'start')) {
    return a.at === b.at
  }
  return false
}
