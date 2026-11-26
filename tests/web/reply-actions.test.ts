import { expect, test } from 'bun:test'
import type { ViewItem } from '../../shared/client/chat/chat-state'
import { replyActions } from '../../shared/client/chat/reply-actions'
import type { ShownFile } from '../../shared/shown-schema'

const image: ShownFile = { id: 's1', name: 'paywall.png', kind: 'image', mime: 'image/png', size: 10, url: '/api/shown/b1/s1' }
const usage = { inputTokens: 10, outputTokens: 5 } as never

test('a reply split by an item copies all its words, once, under its last part', () => {
  const items: ViewItem[] = [
    { kind: 'user', text: 'show me', messageId: 'm1' } as ViewItem,
    { kind: 'assistant', text: 'Here is the paywall.' },
    { kind: 'shown', file: image },
    { kind: 'assistant', text: 'Yearly is first.', usage }
  ]
  expect([...replyActions(items)]).toEqual([[3, { text: 'Here is the paywall.\n\nYearly is first.', usage }]])
})

test('a reply that ends with an item puts Copy under the item; tool lines in between lose no words', () => {
  const items: ViewItem[] = [
    { kind: 'assistant', text: 'Checking.' },
    { kind: 'tool', toolId: 't1', name: 'terminal', detail: '', running: false },
    { kind: 'assistant', text: 'Here it is:' },
    { kind: 'shown', file: image }
  ]
  expect([...replyActions(items)]).toEqual([[3, { text: 'Checking.\n\nHere it is:' }]])
})

test('each reply gets its own; one still being written, or with no words, gets none', () => {
  const items: ViewItem[] = [
    { kind: 'assistant', text: 'First reply.' },
    { kind: 'user', text: 'next', messageId: 'm2' } as ViewItem,
    { kind: 'shown', file: image },
    { kind: 'session', text: 'New session' },
    { kind: 'assistant', text: 'Still writ', streaming: true }
  ]
  expect([...replyActions(items)]).toEqual([[0, { text: 'First reply.' }]])
})

// Copy and the numbers follow turns, not messages (#317 A2). Each of these fails on main (5da88de8b).
const later = { inputTokens: 20, outputTokens: 7 } as never

test('two turns with no message between them each get their own Copy and their own numbers', () => {
  const items: ViewItem[] = [
    { kind: 'user', text: 'Hi', messageId: 'm1' } as ViewItem,
    { kind: 'assistant', text: 'Hello.', usage },
    { kind: 'assistant', text: 'Work item 12 is done.', usage: later }
  ]
  expect([...replyActions(items)]).toEqual([
    [1, { text: 'Hello.', usage }],
    [2, { text: 'Work item 12 is done.', usage: later }]
  ])
})

test('a turn that stopped ends its reply, so the next turn is separate', () => {
  const items: ViewItem[] = [
    { kind: 'assistant', text: 'Half', stopped: true },
    { kind: 'assistant', text: 'Notion is connected.', usage: later }
  ]
  expect([...replyActions(items)]).toEqual([
    [0, { text: 'Half' }],
    [1, { text: 'Notion is connected.', usage: later }]
  ])
})

test('an error line between two turns ends the first; neither copies the other', () => {
  const items: ViewItem[] = [
    { kind: 'assistant', text: 'Checking the build.' },
    { kind: 'error', text: 'The bot reported an error.' },
    { kind: 'assistant', text: 'Goal review: on track.', usage: later }
  ]
  expect([...replyActions(items)]).toEqual([
    [0, { text: 'Checking the build.' }],
    [2, { text: 'Goal review: on track.', usage: later }]
  ])
})

test('a message sent while the bot is busy, drawn mid-reply, does not split it; the next turn is separate', () => {
  const items: ViewItem[] = [
    { kind: 'user', text: 'Look into it', messageId: 'm1' } as ViewItem,
    { kind: 'assistant', text: 'Looking.' },
    { kind: 'tool', toolId: 't1', name: 'terminal', detail: '', running: false },
    { kind: 'user', text: 'Also check logs', messageId: 'm2' } as ViewItem,
    { kind: 'assistant', text: 'Found it.', usage },
    { kind: 'assistant', text: 'Logs are clean.', usage: later }
  ]
  expect([...replyActions(items)]).toEqual([
    [4, { text: 'Looking.\n\nFound it.', usage }],
    [5, { text: 'Logs are clean.', usage: later }]
  ])
})

test('while that reply is still being written it has no Copy, and the message does not give its first half one', () => {
  const items: ViewItem[] = [
    { kind: 'assistant', text: 'Looking.' },
    { kind: 'user', text: 'Also check logs', messageId: 'm2' } as ViewItem,
    { kind: 'assistant', text: 'Found', streaming: true }
  ]
  expect([...replyActions(items)]).toEqual([])
})

test('a reply with no end mark (older history) still ends at the next message', () => {
  const items: ViewItem[] = [{ kind: 'assistant', text: 'Old reply.' }, { kind: 'user', text: 'next', messageId: 'm2' } as ViewItem, { kind: 'assistant', text: 'Old answer.' }]
  expect([...replyActions(items)]).toEqual([
    [0, { text: 'Old reply.' }],
    [2, { text: 'Old answer.' }]
  ])
})
