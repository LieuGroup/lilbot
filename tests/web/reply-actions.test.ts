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
