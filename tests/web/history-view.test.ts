import { describe, expect, test } from 'bun:test'

import type { HistoryPage } from '../../shared/history-schema'
import { type ChatView, chatFromHistory, chatFromSnapshot, withUserMessage } from '../../web/src/chat/chat-state'
import { canLoadOlder, olderRequest, reuseItems, withOlder } from '../../web/src/history/history-view'
import { snapshot } from './chat-helpers'

/** Rows `from` to `to - 1` of one long conversation, as the server pages them. */
function part(from: number, to: number, more: { nextCursor?: string | null; start?: number | null; complete?: boolean } = {}): HistoryPage {
  return {
    items: Array.from({ length: to - from }, (_, n) => {
      const at = from + n
      return { id: `r${at}`, sessionId: 's', at, author: 'user', item: { kind: 'user', text: `m${at}` } }
    }),
    nextCursor: more.nextCursor ?? null,
    start: more.start === undefined ? null : more.start === null ? null : { at: more.start },
    import: { complete: more.complete ?? true, sessions: 1, completed: 1, items: to - from }
  }
}
const texts = (chat: ChatView) => chat.items.map(item => ('text' in item ? item.text : item.kind))

describe('loading earlier parts', () => {
  test('an earlier part goes above with lower positions; the rows on screen keep theirs', () => {
    const latest = chatFromHistory(part(100, 200, { nextCursor: 'c100' }))
    expect(latest).toMatchObject({ first: 0, older: 'c100', start: null })
    expect(canLoadOlder(latest)).toBe(true)
    expect(olderRequest(latest)).toBe('c100')
    const shown = latest.items[0]
    const chat = withOlder(latest, part(0, 100, { start: 0 }), 'c100')
    expect(chat.first).toBe(-100)
    expect(chat.items).toHaveLength(200)
    expect(chat.items[100]).toBe(shown)
    expect(chat).toMatchObject({ older: null, oldestFrom: 'c100', start: 0 })
    expect(canLoadOlder(chat)).toBe(false)
  })

  test('a part fetched for a view that has moved on is ignored', () => {
    const latest = chatFromHistory(part(100, 200, { nextCursor: 'c100' }))
    expect(withOlder(latest, part(0, 100), 'stale')).toBe(latest)
  })

  test('rows already on screen are not added twice', () => {
    const latest = chatFromHistory(part(100, 200, { nextCursor: 'c100' }))
    const chat = withOlder(latest, part(50, 110, { nextCursor: 'c50' }), 'c100')
    expect(texts(chat).slice(0, 3)).toEqual(['m50', 'm51', 'm52'])
    expect(chat.items).toHaveLength(150)
    expect(chat.first).toBe(-50)
  })

  test('while importing, the earliest part is read again and only older rows are added', () => {
    const latest = chatFromHistory(part(100, 200, { complete: false }))
    expect(latest).toMatchObject({ older: null, start: null, importing: true })
    expect(canLoadOlder(latest)).toBe(true)
    expect(olderRequest(latest)).toBeNull()
    // The import brought in 20 earlier rows and finished.
    const reread = { ...part(80, 200, { start: 80 }), items: part(80, 200).items.slice(0, 100) }
    const chat = withOlder(latest, reread, null)
    expect(texts(chat).slice(0, 2)).toEqual(['m80', 'm81'])
    expect(chat).toMatchObject({ first: -20, start: 80, importing: false })
    expect(canLoadOlder(chat)).toBe(false)
  })

  test('the start of a finished import with nothing to load is not a beginning to wait for', () => {
    const chat = chatFromHistory(part(0, 10, { start: 0 }))
    expect(chat.start).toBe(0)
    expect(canLoadOlder(chat)).toBe(false)
  })
})

describe('reopening keeps the earlier parts', () => {
  const loaded = () => withOlder(chatFromHistory(part(100, 200, { nextCursor: 'c100' })), part(0, 100, { nextCursor: 'c0' }), 'c100')

  test('a new latest part that continues the view keeps the rows above, in place', () => {
    const before = withUserMessage(loaded(), 'live')
    // Two more rows were saved: the latest part now starts two rows later.
    const after = chatFromSnapshot(snapshot(part(102, 202, { nextCursor: 'c102' })), before)
    expect(after.first).toBe(-100)
    expect(after.items).toHaveLength(202)
    expect(after.items[0]).toBe(before.items[0])
    expect(after.items[101]).toBe(before.items[101])
    expect(texts(after).at(-1)).toBe('m201')
    expect(after).toMatchObject({ older: 'c0', oldestFrom: 'c100' })
  })

  test('a latest part that no longer meets the view starts it again', () => {
    const after = chatFromSnapshot(snapshot(part(500, 600, { nextCursor: 'c500' })), loaded())
    expect(after.items).toHaveLength(100)
    expect(after).toMatchObject({ older: 'c500', oldestFrom: null })
  })
})

test('repeated identical items pair with earlier objects one to one', () => {
  const a = { kind: 'user', text: 'ok' } as const
  const b = { kind: 'user', text: 'ok' } as const
  const next = reuseItems(
    [a, b],
    [
      { kind: 'user', text: 'ok' },
      { kind: 'user', text: 'ok' },
      { kind: 'user', text: 'ok' }
    ]
  )
  expect(next[0]).toBe(a)
  expect(next[1]).toBe(b)
  expect(next[2]).not.toBe(a)
  expect(next[2]).not.toBe(b)
})
