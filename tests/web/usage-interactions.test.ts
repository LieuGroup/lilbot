import { describe, expect, test } from 'bun:test'

import { applyChatEvent, emptyChat } from '../../web/src/chat/chat-state'
import { withUserMessage } from '../../web/src/chat/user-messages'
import { withOlder } from '../../web/src/history/history-view'
import { contextMeterOnClick, toggleOnClick } from '../../web/src/history/usage-trigger'
import { play } from './chat-helpers'

describe('popover trigger state transitions', () => {
  test('hovering the context meter and clicking it pins it open even after outside-press dismissed it on pointerdown', () => {
    const down = { open: true, pinned: false }
    const afterOutsideDismiss = { open: false, pinned: false }
    expect(contextMeterOnClick(afterOutsideDismiss, down)).toEqual({ open: true, pinned: true })
  })

  test('a slow click on an already-pinned context meter or open turn-numbers button closes without reopening', () => {
    expect(contextMeterOnClick({ open: false, pinned: false }, { open: true, pinned: true })).toEqual({ open: false, pinned: false })
    expect(toggleOnClick(false, { open: true })).toBe(false)
    expect(contextMeterOnClick({ open: false, pinned: false }, { open: false, pinned: false })).toEqual({ open: true, pinned: true })
    expect(contextMeterOnClick({ open: false, pinned: false }, null)).toEqual({ open: true, pinned: true })
    expect(contextMeterOnClick({ open: true, pinned: true }, null)).toEqual({ open: false, pinned: false })
    expect(toggleOnClick(false, { open: false })).toBe(true)
    expect(toggleOnClick(false, null)).toBe(true)
    expect(toggleOnClick(true, null)).toBe(false)
  })
})

describe('live compaction placement and active-turn boundary', () => {
  test('places live compaction before the triggering user message and any tool calls, and keeps turnStart stable across older-history loads', () => {
    const usage = { inputTokens: 980, cacheReadTokens: 0, cacheWriteTokens: 18_000, outputTokens: 120, contextTokens: 19_100, contextWindow: 200_000 }
    let chat = play(
      withUserMessage(emptyChat, 'first'),
      { type: 'turn.started' },
      { type: 'text.delta', text: 'Uploaded screenshots.' },
      { type: 'turn.finished', status: 'completed', text: 'Uploaded screenshots.' }
    )
    chat = withUserMessage({ ...chat, older: 'c1' }, 'now write release notes')
    expect(chat.turnStart).toBe(2)
    chat = play(
      chat,
      { type: 'turn.started' },
      { type: 'text.delta', text: 'Checking notes.' },
      { type: 'tool.started', toolId: 't1', name: 'terminal', detail: 'ls' },
      { type: 'tool.finished', toolId: 't1', failed: false },
      { type: 'text.delta', text: 'Release notes ready.' }
    )
    expect(chat.running).toBe(true)
    expect(chat.turnStart).toBe(2)
    chat = withOlder(
      chat,
      {
        items: [{ id: 'old-1', sessionId: 's1', at: 100, author: 'user', item: { kind: 'user', text: 'earlier' } }],
        nextCursor: null,
        start: { at: 100 },
        import: { complete: true, sessions: 1, completed: 1, items: 1 }
      },
      'c1'
    )
    expect(chat.turnStart).toBe(3)
    chat = applyChatEvent(chat, {
      type: 'turn.finished',
      status: 'completed',
      text: 'Release notes ready.',
      usage,
      compacted: { beforeTokens: 95_000, afterTokens: 18_500 }
    })
    expect(chat.running).toBe(false)
    expect(chat.turnStart).toBeNull()
    expect(chat.items.map(i => i.kind)).toEqual(['user', 'user', 'assistant', 'compaction', 'user', 'assistant', 'tool', 'assistant'])
    expect(chat.items[3]).toEqual({ kind: 'compaction', beforeTokens: 95_000, afterTokens: 18_500 })
    expect(chat.items[4]).toMatchObject({ kind: 'user', text: 'now write release notes' })
    expect(chat.items[7]).toMatchObject({ kind: 'assistant', text: 'Release notes ready.', usage })
  })

  test('places live compaction at the turn boundary for tool-only and bare turns', () => {
    const toolOnly = play(
      withUserMessage(emptyChat, 'quiet task'),
      { type: 'turn.started' },
      { type: 'tool.started', toolId: 't1', name: 'terminal', detail: 'true' },
      { type: 'tool.finished', toolId: 't1', failed: false },
      { type: 'turn.finished', status: 'completed', text: '', compacted: { beforeTokens: 80_000, afterTokens: 15_000 } }
    )
    expect(toolOnly.items.map(i => i.kind)).toEqual(['compaction', 'user', 'tool'])

    const bare = play(
      emptyChat,
      { type: 'turn.started' },
      { type: 'text.delta', text: 'Working' },
      { type: 'user.message', messageId: 'm4', text: 'from phone', attachments: [], images: { support: 'unknown', imageCount: 0 } },
      { type: 'turn.finished', status: 'completed', text: 'Working', compacted: { beforeTokens: 70_000, afterTokens: 12_000 } }
    )
    expect(bare.items.map(i => i.kind)).toEqual(['compaction', 'user', 'assistant'])
  })
})
