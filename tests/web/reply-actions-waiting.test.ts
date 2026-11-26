/** Pins what a message sent while the bot was busy does to a reply's actions row (#317's Copy and turn numbers), as both
 *  behaviours stand: the waiting message sits where it was sent, and a message ends a reply. Grouping is #317's to change. */
import { expect, test } from 'bun:test'
import { emptyChat } from '../../shared/client/chat/chat-state'
import { replyActions } from '../../shared/client/chat/reply-actions'
import { withUserMessage } from '../../shared/client/chat/user-messages'
import { play, texts } from './chat-helpers'

const usage = { inputTokens: 10, outputTokens: 5 }

test('a message sent mid-reply splits that reply in two, and its second part joins the reply to the message', () => {
  let chat = play(withUserMessage(emptyChat, 'check the river'), { type: 'turn.started' }, { type: 'text.delta', text: 'Checking.' })
  chat = withUserMessage(chat, 'also the lake')
  chat = play(
    chat,
    { type: 'tool.started', toolId: 't1', name: 'terminal', detail: 'sleep 8' },
    { type: 'tool.finished', toolId: 't1', failed: false },
    { type: 'text.delta', text: 'The river is fine.' },
    { type: 'turn.finished', status: 'completed', text: 'The river is fine.', usage },
    { type: 'turn.started' },
    { type: 'text.delta', text: 'The lake is fine.' },
    { type: 'turn.finished', status: 'completed', text: 'The lake is fine.', usage }
  )
  expect(texts(chat)).toEqual(['user:check the river', 'assistant:Checking.', 'user:also the lake', 'tool:terminal', 'assistant:The river is fine.', 'assistant:The lake is fine.'])
  expect([...replyActions(chat.items)]).toEqual([
    [1, { text: 'Checking.' }],
    [5, { text: 'The river is fine.\n\nThe lake is fine.', usage }]
  ])
})

test('a message sent before the reply wrote anything leaves the replies whole', () => {
  let chat = play(withUserMessage(emptyChat, 'check the river'), { type: 'turn.started' }, { type: 'tool.started', toolId: 't1', name: 'terminal', detail: 'sleep 8' })
  chat = withUserMessage(chat, 'also the lake')
  chat = play(
    chat,
    { type: 'tool.finished', toolId: 't1', failed: false },
    { type: 'text.delta', text: 'The river is fine.' },
    { type: 'turn.finished', status: 'completed', text: 'The river is fine.', usage },
    { type: 'turn.started' },
    { type: 'text.delta', text: 'The lake is fine.' },
    { type: 'turn.finished', status: 'completed', text: 'The lake is fine.', usage }
  )
  expect(texts(chat)).toEqual(['user:check the river', 'tool:terminal', 'user:also the lake', 'assistant:The river is fine.', 'assistant:The lake is fine.'])
  expect([...replyActions(chat.items)]).toEqual([[4, { text: 'The river is fine.\n\nThe lake is fine.', usage }]])
})
