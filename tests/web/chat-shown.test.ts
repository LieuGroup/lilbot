import { expect, test } from 'bun:test'
import { reconstructFromEvents } from '../../server/history/history-tail'
import type { ChatEvent } from '../../shared/chat-schema'
import { applyChatEvent, emptyChat } from '../../shared/client/chat/chat-state'
import { withUserMessage } from '../../shared/client/chat/user-messages'
import type { ShownFile } from '../../shared/shown-schema'
import { play } from './chat-helpers'

const image: ShownFile = { id: 's1', name: 'paywall.png', kind: 'image', mime: 'image/png', size: 10, caption: 'Yearly first', url: '/api/shown/b1/s1' }
const video: ShownFile = { id: 's2', name: 'onboarding.mp4', kind: 'video', mime: 'video/mp4', size: 20, url: '/api/shown/b1/s2' }
const showCall = (toolId: string): ChatEvent => ({ type: 'tool.started', toolId, name: 'mcp__lilbot_system__lilbot_show', detail: '' })

test('an item lands right after the words written so far, splits the reply there, and the engine row for the call is not drawn', () => {
  const chat = play(
    withUserMessage(emptyChat, 'show me'),
    { type: 'turn.started' },
    { type: 'text.delta', text: 'Here is the paywall.' },
    showCall('t1'),
    { type: 'shown', file: image },
    { type: 'tool.finished', toolId: 't1', failed: false },
    { type: 'text.delta', text: 'And the clip.' },
    showCall('t2'),
    { type: 'shown', file: video },
    { type: 'text.delta', text: 'Both are ready.' },
    { type: 'turn.finished', status: 'completed', text: 'Both are ready.' }
  )
  expect(
    chat.items.map(item => (item.kind === 'shown' ? `shown:${item.file.name}` : item.kind === 'assistant' || item.kind === 'user' ? `${item.kind}:${item.text}` : item.kind))
  ).toEqual(['user:show me', 'assistant:Here is the paywall.', 'shown:paywall.png', 'assistant:And the clip.', 'shown:onboarding.mp4', 'assistant:Both are ready.'])
  expect(chat.items.some(item => item.kind === 'assistant' && item.streaming)).toBe(false)
})

test('the same item sent twice (a reconnect) is drawn once', () => {
  const once = applyChatEvent(emptyChat, { type: 'shown', file: image })
  expect(applyChatEvent(once, { type: 'shown', file: image }).items).toHaveLength(1)
})

test('the journal rebuilds a reply with its items in place after a reload, without the call rows', () => {
  const events: ChatEvent[] = [
    { type: 'turn.started' },
    { type: 'text.delta', text: 'Here is the paywall.' },
    showCall('t1'),
    { type: 'tool.finished', toolId: 't1', failed: false },
    { type: 'turn.finished', status: 'completed', text: 'Done.' }
  ]
  const rows = reconstructFromEvents(
    'c1',
    events.map((event, i) => ({ rowid: i + 1, at: 1000 + i, event: JSON.stringify(event), key: `k${i}` }))
  )
  expect(rows.map(row => row.item.kind)).toEqual(['assistant'])
})
