# The test PR 325 must ship with once PR 334 is on main

Back to [the pause record](../paused-2026-11.md) and [parked work](parked-work.md#pr-325-record-only-sessions-lilbot-owns-and-place-each-item-where-it-was-sent).

PR 325's own `tests/web/reply-actions-waiting.test.ts` assumes main's old Copy grouping, so it fails 2 of 2 once PR
334 is merged. With this file in its place, `tests/web` passed 226/0 and `tsc` was clean on 334 + 325. After merging
main (with 334) into `fix/conversation-record-scope`, replace that file's whole content with the block below, in one
commit, then run verify and one locked `check:record-scope`.

```ts
/** Pins what a message sent while the bot was busy does to a reply's actions row (#317's Copy and turn numbers): the
 *  waiting message sits where it was sent, and Copy follows turns (#334). Grouping is #317's to change. */
import { expect, test } from 'bun:test'
import { emptyChat } from '../../shared/client/chat/chat-state'
import { replyActions } from '../../shared/client/chat/reply-actions'
import { withUserMessage } from '../../shared/client/chat/user-messages'
import { play, texts } from './chat-helpers'

const usage = { inputTokens: 10, outputTokens: 5 }
const lake = { inputTokens: 20, outputTokens: 7 }

test('a message sent mid-reply splits off the words before it; each turn keeps its own Copy and numbers', () => {
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
    { type: 'turn.finished', status: 'completed', text: 'The lake is fine.', usage: lake }
  )
  expect(texts(chat)).toEqual(['user:check the river', 'assistant:Checking.', 'user:also the lake', 'tool:terminal', 'assistant:The river is fine.', 'assistant:The lake is fine.'])
  expect([...replyActions(chat.items)]).toEqual([
    [1, { text: 'Checking.' }],
    [4, { text: 'The river is fine.', usage }],
    [5, { text: 'The lake is fine.', usage: lake }]
  ])
})

test('a message sent before the reply wrote anything leaves each turn whole, with its own Copy and numbers', () => {
  let chat = play(withUserMessage(emptyChat, 'check the river'), { type: 'turn.started' }, { type: 'tool.started', toolId: 't1', name: 'terminal', detail: 'sleep 8' })
  chat = withUserMessage(chat, 'also the lake')
  chat = play(
    chat,
    { type: 'tool.finished', toolId: 't1', failed: false },
    { type: 'text.delta', text: 'The river is fine.' },
    { type: 'turn.finished', status: 'completed', text: 'The river is fine.', usage },
    { type: 'turn.started' },
    { type: 'text.delta', text: 'The lake is fine.' },
    { type: 'turn.finished', status: 'completed', text: 'The lake is fine.', usage: lake }
  )
  expect(texts(chat)).toEqual(['user:check the river', 'tool:terminal', 'user:also the lake', 'assistant:The river is fine.', 'assistant:The lake is fine.'])
  expect([...replyActions(chat.items)]).toEqual([
    [3, { text: 'The river is fine.', usage }],
    [4, { text: 'The lake is fine.', usage: lake }]
  ])
})
```
