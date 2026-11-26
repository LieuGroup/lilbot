/** Projects finished routine/webhook transcript items to what the screens render and bounds each saved transcript.
 *  User messages (wrapper prompts and incoming webhook payloads), unused tool result payloads, and sign-in cards are
 *  stripped; oversized transcripts keep the start and end with a visible omitted-middle marker instead of failing. */
import type { ChatItem } from '../../shared/chat-schema'

/** 256 KiB UTF-8 serialized JSON per finished run: larger than routine/webhook summary results (200k chars) so normal
 *  multi-step runs save intact, while bounding SQLite growth and WebSocket snapshot size. */
export const MAX_TRANSCRIPT_BYTES = 256 * 1024
const MAX_TOOL_DETAIL_CHARS = 500
const OMITTED_TEXT = 'Middle of this transcript was not kept to stay within the size limit.'

const byteLen = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8')

function capDetail(detail: string): string {
  if (detail.length <= MAX_TOOL_DETAIL_CHARS) return detail
  let cut = MAX_TOOL_DETAIL_CHARS - 1
  if (cut > 0 && detail.charCodeAt(cut - 1) >= 0xd800 && detail.charCodeAt(cut - 1) <= 0xdbff) cut--
  return `${detail.slice(0, cut)}…`
}

function projectItem(item: ChatItem): ChatItem[] {
  switch (item.kind) {
    case 'user':
    case 'connection.sign_in':
    case 'shown':
      return []
    case 'assistant':
      return [{ kind: 'assistant', text: item.text, ...(item.stopped ? { stopped: true } : {}), ...(item.usage ? { usage: item.usage } : {}) }]
    case 'tool':
      return [
        {
          kind: 'tool',
          toolId: item.toolId,
          name: item.name,
          detail: capDetail(item.detail),
          running: false,
          ...(item.failed ? { failed: true } : {}),
          ...(item.threadId ? { threadId: item.threadId } : {}),
          ...(item.workItemId ? { workItemId: item.workItemId } : {})
        }
      ]
    case 'compaction':
      return [
        {
          kind: 'compaction',
          ...(item.compactedMessages !== undefined ? { compactedMessages: item.compactedMessages } : {}),
          ...(item.beforeTokens !== undefined ? { beforeTokens: item.beforeTokens } : {}),
          ...(item.afterTokens !== undefined ? { afterTokens: item.afterTokens } : {}),
          ...(item.summary ? { summary: item.summary } : {})
        }
      ]
    case 'error':
      return [{ kind: 'error', text: item.reason ? '' : item.text, ...(item.reason ? { reason: item.reason } : {}) }]
    case 'omitted':
      return [{ kind: 'omitted', text: item.text }]
  }
}

const omittedMarker = (count?: number): ChatItem => ({
  kind: 'omitted',
  text: count && count > 0 ? `Middle of this transcript (${count} ${count === 1 ? 'item' : 'items'}) was not kept to stay within the size limit.` : OMITTED_TEXT
})

function safeSlice(text: string, len: number, fromEnd: boolean): string {
  if (len <= 0) return ''
  if (len >= text.length) return text
  if (!fromEnd) {
    let end = len
    if (end > 0 && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end--
    return text.slice(0, end)
  }
  let start = text.length - len
  if (start < text.length && text.charCodeAt(start) >= 0xdc00 && text.charCodeAt(start) <= 0xdfff) start++
  return text.slice(start)
}

function trimItem(item: ChatItem, targetBytes: number, fromEnd: boolean): ChatItem | null {
  if (targetBytes <= 0) return null
  if (byteLen(item) <= targetBytes) return item
  const text = item.kind === 'assistant' ? item.text : item.kind === 'error' && !item.reason ? item.text : item.kind === 'compaction' ? item.summary : undefined
  if (!text) return null
  const build = (slice: string): ChatItem => {
    if (item.kind === 'assistant')
      return { kind: 'assistant', text: slice, ...(fromEnd && item.stopped ? { stopped: true } : {}), ...(fromEnd && item.usage ? { usage: item.usage } : {}) }
    if (item.kind === 'error') return { kind: 'error', text: slice }
    return item.kind === 'compaction' ? { ...item, summary: slice } : { kind: 'omitted', text: slice }
  }
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (byteLen(build(safeSlice(text, mid, fromEnd))) <= targetBytes) lo = mid
    else hi = mid - 1
  }
  const sliced = safeSlice(text, lo, fromEnd)
  return sliced ? build(sliced) : null
}

/** Strips non-rendered fields and bounds serialized UTF-8 byte length to `maxBytes`. */
export function prepareTranscriptItems(items: ChatItem[], maxBytes = MAX_TRANSCRIPT_BYTES): ChatItem[] {
  const projected = items.flatMap(projectItem)
  if (byteLen(projected) <= maxBytes) return projected

  const markerReserve = byteLen(omittedMarker(projected.length)) + 2
  const budget = Math.max(0, maxBytes - 2 - markerReserve)
  const headCap = Math.floor(budget * 0.4)

  if (projected.length === 1) {
    const first = trimItem(projected[0], headCap - 1, false)
    const last = trimItem(projected[0], budget - (first ? byteLen(first) + 1 : 0) - 1, true)
    return [...(first ? [first] : []), omittedMarker(), ...(last ? [last] : [])]
  }

  const sizes = projected.map(item => byteLen(item) + 1)
  let headEnd = 0
  let headBytes = 0
  while (headEnd < projected.length && headBytes + sizes[headEnd] <= headCap) {
    headBytes += sizes[headEnd]
    headEnd++
  }

  const tailCap = headEnd === 0 ? budget - headCap : budget - headBytes
  let tailStart = projected.length
  let tailBytes = 0
  while (tailStart > headEnd && tailBytes + sizes[tailStart - 1] <= tailCap) {
    tailStart--
    tailBytes += sizes[tailStart]
  }

  if (headEnd > 0 && tailStart < projected.length) {
    while (headEnd < tailStart && headBytes + tailBytes + sizes[headEnd] <= budget) {
      headBytes += sizes[headEnd]
      headEnd++
    }
  }

  const head = projected.slice(0, headEnd)
  const tail = projected.slice(tailStart)
  let middleCount = tailStart - headEnd
  if (headEnd === 0) {
    const cap = tailStart === projected.length ? headCap : Math.max(0, budget - tailBytes)
    const partial = trimItem(projected[0], cap - 1, false)
    if (partial) {
      head.push(partial)
      middleCount = Math.max(0, middleCount - 1)
    }
  }
  if (tailStart === projected.length) {
    const usedNow = head.reduce((sum, item) => sum + byteLen(item) + 1, 0)
    const partial = trimItem(projected[projected.length - 1], Math.max(0, budget - usedNow - 1), true)
    if (partial) {
      tail.push(partial)
      middleCount = Math.max(0, middleCount - 1)
    }
  }
  return [...head, omittedMarker(middleCount > 0 && headEnd > 0 && tailStart < projected.length ? middleCount : undefined), ...tail]
}
