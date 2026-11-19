import { describe, expect, test } from 'bun:test'

import type { ChatEvent } from '../../shared/chat-schema'
import type { HistoryPage } from '../../shared/history-schema'
import { applyChatEvent, type ChatView, chatFromHistory, chatFromSnapshot, emptyChat, reuseItems, withSentMessage, withUserMessage } from '../../web/src/chat/chat-state'

const play = (chat: ChatView, ...events: ChatEvent[]) => events.reduce(applyChatEvent, chat)
const texts = (chat: ChatView) => chat.items.map(item => (item.kind === 'tool' ? `tool:${item.name}` : `${item.kind}:${item.text}`))

describe('a normal turn', () => {
  test('streams text into one assistant message and finishes', () => {
    const chat = play(
      withUserMessage(emptyChat, 'hi'),
      { type: 'turn.started' },
      { type: 'text.delta', text: 'Hel' },
      { type: 'text.delta', text: 'lo' },
      { type: 'turn.finished', status: 'completed', text: 'Hello' }
    )
    expect(texts(chat)).toEqual(['user:hi', 'assistant:Hello'])
    expect(chat.running).toBe(false)
    expect(chat.items[1]).toMatchObject({ streaming: false, stopped: false })
  })

  test('a tool call splits the reply and is marked done or failed', () => {
    const chat = play(
      withUserMessage(emptyChat, 'run it'),
      { type: 'turn.started' },
      { type: 'text.delta', text: 'Checking.' },
      { type: 'tool.started', toolId: 't1', name: 'terminal', detail: 'ls' },
      { type: 'tool.finished', toolId: 't1', failed: true },
      { type: 'text.delta', text: 'It failed.' },
      { type: 'turn.finished', status: 'completed', text: 'It failed.' }
    )
    expect(texts(chat)).toEqual(['user:run it', 'assistant:Checking.', 'tool:terminal', 'assistant:It failed.'])
    expect(chat.items[2]).toMatchObject({ running: false, failed: true })
  })

  test('a turn that ends with tools and no text is not shown as an error', () => {
    const chat = play(
      withUserMessage(emptyChat, 'do it quietly'),
      { type: 'turn.started' },
      { type: 'tool.started', toolId: 't1', name: 'terminal', detail: '' },
      { type: 'tool.finished', toolId: 't1', failed: false },
      { type: 'turn.finished', status: 'completed', text: '' }
    )
    expect(chat.items.some(item => item.kind === 'error')).toBe(false)
  })

  test('a failed turn with no text says so', () => {
    const chat = play(withUserMessage(emptyChat, 'x'), { type: 'turn.started' }, { type: 'turn.finished', status: 'failed', text: '' })
    expect(chat.items.at(-1)?.kind).toBe('error')
  })

  test('a stopped turn keeps the partial text and is marked stopped', () => {
    const chat = play(
      withUserMessage(emptyChat, 'count'),
      { type: 'turn.started' },
      { type: 'text.delta', text: '1 2 3' },
      { type: 'turn.finished', status: 'stopped', text: '1 2 3' }
    )
    expect(chat.items.at(-1)).toMatchObject({ kind: 'assistant', text: '1 2 3', stopped: true })
  })
})

describe('messages sent while the bot is busy', () => {
  test('wait in the queue and join the transcript when their own turn starts', () => {
    let chat = play(withUserMessage(emptyChat, 'first'), { type: 'turn.started' }, { type: 'text.delta', text: 'Working on fi' })
    chat = withUserMessage(chat, 'second')
    expect(chat.queued).toEqual([{ kind: 'user', text: 'second' }])
    expect(texts(chat)).toEqual(['user:first', 'assistant:Working on fi'])

    chat = play(chat, { type: 'text.delta', text: 'rst.' }, { type: 'turn.finished', status: 'completed', text: 'Working on first.' })
    expect(texts(chat)).toEqual(['user:first', 'assistant:Working on first.'])
    expect(chat.running).toBe(true)

    chat = play(chat, { type: 'turn.started' }, { type: 'text.delta', text: 'Second done.' }, { type: 'turn.finished', status: 'completed', text: 'Second done.' })
    expect(texts(chat)).toEqual(['user:first', 'assistant:Working on first.', 'user:second', 'assistant:Second done.'])
    expect(chat.queued).toEqual([])
    expect(chat.running).toBe(false)
  })

  test('a second message sent before the first turn started does not jump ahead of the first reply', () => {
    let chat = withUserMessage(emptyChat, 'first')
    chat = withUserMessage(chat, 'second')
    chat = play(chat, { type: 'turn.started' }, { type: 'text.delta', text: 'A1' })
    expect(texts(chat)).toEqual(['user:first', 'assistant:A1'])
    expect(chat.queued).toEqual([{ kind: 'user', text: 'second' }])
  })
})

describe('joining a chat that is already running', () => {
  test('uses the full final text when only the end of the reply was streamed here', () => {
    const snapshot = chatFromSnapshot({ chatId: 'c1', botId: 'b', title: '', running: true, workspace: '', items: [{ kind: 'user', text: 'write' }] })
    const chat = play(snapshot, { type: 'text.delta', text: 'the end.' }, { type: 'turn.finished', status: 'completed', text: 'The start and the end.' })
    expect(chat.items.at(-1)).toMatchObject({ kind: 'assistant', text: 'The start and the end.' })
  })

  test('keeps the streamed text when the final text is something else', () => {
    const chat = play(withUserMessage(emptyChat, 'x'), { type: 'turn.started' }, { type: 'text.delta', text: 'streamed' }, { type: 'turn.finished', status: 'completed', text: '' })
    expect(chat.items.at(-1)).toMatchObject({ text: 'streamed' })
  })
})

test('unchanged items keep their identity, so the page does not render them again', () => {
  const before = play(withUserMessage(emptyChat, 'hi'), { type: 'turn.started' }, { type: 'text.delta', text: 'a' })
  const after = applyChatEvent(before, { type: 'text.delta', text: 'b' })
  expect(after.items[0]).toBe(before.items[0])
  expect(after.items[1]).not.toBe(before.items[1])
})

test('closed and error stop the running state', () => {
  const running = play(withUserMessage(emptyChat, 'hi'), { type: 'turn.started' })
  expect(applyChatEvent(running, { type: 'closed', message: 'lost' }).running).toBe(false)
  const failed = applyChatEvent(running, { type: 'error', message: 'boom' })
  expect(failed.running).toBe(false)
  expect(failed.items.at(-1)).toEqual({ kind: 'error', text: 'boom' })
})

test('thread references arrive once in the live stream and deduplicate snapshot references', () => {
  const event = { type: 'thread', threadId: 'shared-thread', name: 'message to', detail: 'Engineer' } as const
  const next = applyChatEvent(emptyChat, event)
  expect(next.items).toEqual([{ kind: 'tool', toolId: 'thread:shared-thread', threadId: 'shared-thread', name: 'message to', detail: 'Engineer', running: false }])
  expect(applyChatEvent(next, event)).toBe(next)
})

describe('messages with files', () => {
  const file = (id: string, mime = 'image/png') => ({
    id,
    name: `${id}.png`,
    size: 10,
    mime,
    state: 'ready' as const,
    url: `/api/attachments/b/${id}`,
    uploadUrl: `/api/attachments/b/${id}`
  })
  const record = (messageId: string, support: 'unsupported' | 'unknown' = 'unsupported') => ({
    messageId,
    text: 'look',
    attachments: [file('a')],
    images: { support, imageCount: 1 }
  })

  test('the server record fills in the message already on screen, keeping every other item', () => {
    const before = play(withUserMessage(emptyChat, 'hi'), { type: 'turn.started' }, { type: 'turn.finished', status: 'completed', text: 'hello' })
    const sent = withUserMessage(before, { kind: 'user', text: 'look', messageId: 'm1', attachments: [file('a')] })
    const chat = applyChatEvent(sent, { type: 'user.message', ...record('m1') })
    expect(chat.items).toHaveLength(3)
    expect(chat.items[0]).toBe(sent.items[0])
    expect(chat.items[1]).toBe(sent.items[1])
    expect(chat.items[2]).toMatchObject({ kind: 'user', messageId: 'm1', images: { support: 'unsupported', imageCount: 1 } })
  })

  test('whichever of the answer and the event arrives second changes nothing more', () => {
    const sent = withUserMessage(emptyChat, { kind: 'user', text: 'look', messageId: 'm1', attachments: [file('a')] })
    const once = withSentMessage(sent, record('m1'))
    const twice = applyChatEvent(once, { type: 'user.message', ...record('m1') })
    expect(twice.items).toHaveLength(1)
    expect(twice.queued).toEqual([])
  })

  test('an unknown message id leaves the chat as it is', () => {
    const sent = withUserMessage(emptyChat, 'plain')
    expect(applyChatEvent(sent, { type: 'user.message', ...record('other') })).toBe(sent)
  })

  test('a queued message keeps its files and joins the transcript with them', () => {
    let chat = play(withUserMessage(emptyChat, 'first'), { type: 'turn.started' })
    chat = withUserMessage(chat, { kind: 'user', text: '', messageId: 'm2', attachments: [file('b')] })
    chat = withSentMessage(chat, { ...record('m2', 'unknown'), text: '', attachments: [file('b')] })
    expect(chat.queued[0]).toMatchObject({ messageId: 'm2', images: { support: 'unknown' } })
    chat = play(chat, { type: 'turn.finished', status: 'completed', text: 'one' }, { type: 'turn.started' })
    expect(chat.items.at(-1)).toMatchObject({ kind: 'user', messageId: 'm2', attachments: [{ id: 'b' }] })
    expect(chat.queued).toEqual([])
  })
})

describe('opening a chat', () => {
  const snapshot = (items: ChatView['items']) => ({ chatId: 'main', botId: 'b', title: '', running: false, workspace: '', items })
  const page = (sessionId: string, items: HistoryPage['items'][number]['item'][]): HistoryPage => ({
    items: items.map((item, n) => ({ id: `r${n}`, sessionId, at: n, author: item.kind === 'user' ? 'user' : 'bot', item })),
    nextCursor: null,
    start: null,
    import: { complete: true, sessions: 1, completed: 1, items: items.length }
  })

  test('shows the saved conversation without session dividers, named after its latest session', () => {
    const chat = chatFromHistory(
      page('main', [
        { kind: 'session', text: 'New session' },
        { kind: 'user', text: 'hi' },
        { kind: 'assistant', text: 'hello' }
      ])
    )
    expect(chat).toMatchObject({ chatId: 'main', running: false, load: 1 })
    expect(texts(chat)).toEqual(['user:hi', 'assistant:hello'])
  })

  test('the snapshot keeps the objects of unchanged items and counts as a new load', () => {
    const shown = chatFromHistory(
      page('main', [
        { kind: 'user', text: 'hi' },
        { kind: 'assistant', text: 'hello' }
      ])
    )
    const opened = chatFromSnapshot(
      snapshot([
        { kind: 'user', text: 'hi' },
        { kind: 'assistant', text: 'hello, edited' },
        { kind: 'user', text: 'new' }
      ]),
      shown
    )
    expect(opened.items[0]).toBe(shown.items[0])
    expect(opened.items[1]).not.toBe(shown.items[1])
    expect(texts(opened)).toEqual(['user:hi', 'assistant:hello, edited', 'user:new'])
    expect(opened.load).toBe(2)
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
})
