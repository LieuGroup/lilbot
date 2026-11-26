import { describe, expect, test } from 'bun:test'
import { applyChatEvent, chatFromSnapshot, emptyChat } from '../../shared/client/chat/chat-state'
import { withSentMessage, withUserMessage } from '../../shared/client/chat/user-messages'
import { failureLine } from '../../web/src/chat/chat-item'
import { play, texts } from './chat-helpers'

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

  test("a turn that stopped for want of the memory save gets one line in LilBot's words, after any text it had streamed", () => {
    const failed = { type: 'turn.finished', status: 'failed', text: '', failure: 'memory_save' } as const
    expect(play(withUserMessage(emptyChat, 'x'), { type: 'turn.started' }, failed).items.slice(1)).toEqual([{ kind: 'error', text: '', reason: 'memory_save' }])
    const streamed = play(withUserMessage(emptyChat, 'x'), { type: 'turn.started' }, { type: 'text.delta', text: 'Working on it.' }, failed)
    expect(texts(streamed)).toEqual(['user:x', 'assistant:Working on it.', 'error:'])
    expect(failureLine('memory_save', 'Chief of Staff')).toStartWith("Chief of Staff couldn't save its memory before shortening this long conversation")
    expect(failureLine('memory_save', undefined)).toStartWith("The bot couldn't save")
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
  test('appear at once where they were sent, wait there, and the reply being written goes on above them', () => {
    let chat = play(withUserMessage(emptyChat, 'first'), { type: 'turn.started' }, { type: 'text.delta', text: 'Working on fi' })
    chat = withUserMessage(chat, 'second')
    expect(chat.queued).toEqual([{ kind: 'user', text: 'second' }])
    expect(texts(chat)).toEqual(['user:first', 'assistant:Working on fi', 'user:second'])

    chat = play(chat, { type: 'text.delta', text: 'rst.' }, { type: 'turn.finished', status: 'completed', text: 'Working on first.' })
    expect(texts(chat)).toEqual(['user:first', 'assistant:Working on first.', 'user:second'])
    expect(chat.running).toBe(true)

    chat = play(chat, { type: 'turn.started' }, { type: 'text.delta', text: 'Second done.' }, { type: 'turn.finished', status: 'completed', text: 'Second done.' })
    expect(texts(chat)).toEqual(['user:first', 'assistant:Working on first.', 'user:second', 'assistant:Second done.'])
    expect(chat.queued).toEqual([])
    expect(chat.running).toBe(false)
  })

  test("a message sent while a turn with no message of its own (a hidden turn) runs stays above that turn's later reply", () => {
    let chat = play(emptyChat, { type: 'turn.started' }, { type: 'tool.started', toolId: 't', name: 'connect', detail: '' })
    chat = withUserMessage(chat, { kind: 'user', text: 'i have connected paper mcp to lilbot', messageId: 'm1' })
    chat = play(chat, { type: 'tool.finished', toolId: 't', failed: false }, { type: 'text.delta', text: 'Paper is connected.' })
    chat = play(chat, { type: 'turn.finished', status: 'completed', text: 'Paper is connected.' }, { type: 'turn.started' })
    expect(texts(chat)).toEqual(['tool:connect', 'user:i have connected paper mcp to lilbot', 'assistant:Paper is connected.'])
    expect(chat).toMatchObject({ queued: [], turnStart: 1 })
    // The engine echoing the message once its turn starts adds nothing.
    chat = applyChatEvent(chat, {
      type: 'user.message',
      messageId: 'm1',
      text: 'i have connected paper mcp to lilbot',
      attachments: [],
      images: { support: 'unknown', imageCount: 0 }
    })
    expect(texts(chat).filter(text => text.startsWith('user:'))).toHaveLength(1)
  })

  test('a second message sent before the first turn started keeps its place and waits there', () => {
    let chat = withUserMessage(emptyChat, 'first')
    chat = withUserMessage(chat, 'second')
    chat = play(chat, { type: 'turn.started' }, { type: 'text.delta', text: 'A1' })
    expect(texts(chat)).toEqual(['user:first', 'user:second', 'assistant:A1'])
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

test("the server's record of a sent message fills in where it came from", () => {
  const chat = withUserMessage(emptyChat, { kind: 'user', text: 'hi', messageId: 'm1' })
  const origin = { deviceId: 'd1', name: 'Mac · Chrome' }
  const sent = withSentMessage(chat, { messageId: 'm1', text: 'hi', attachments: [], images: { support: 'unknown', imageCount: 0 }, origin })
  expect(sent.items[0]).toMatchObject({ kind: 'user', text: 'hi', origin })
})

test('a message sent from another device joins the conversation once, with where it came from', () => {
  const origin = { deviceId: 'phone', name: 'iPhone · Safari' }
  const message = { messageId: 'm2', text: 'from the phone', attachments: [], images: { support: 'unknown' as const, imageCount: 0 }, origin }
  const chat = play(
    emptyChat,
    { type: 'user.message', ...message },
    { type: 'turn.started' },
    { type: 'user.message', ...message },
    { type: 'turn.finished', status: 'completed', text: 'ok' }
  )
  expect(texts(chat)).toEqual(['user:from the phone', 'assistant:ok'])
  expect(chat.items[0]).toMatchObject({ origin })
  expect(chat.running).toBe(false)
})

test("a message from another device whose turn started first goes before that turn's reply", () => {
  const origin = { deviceId: 'phone', name: 'iPhone · Safari' }
  const message = { messageId: 'm3', text: 'late event', attachments: [], images: { support: 'unknown' as const, imageCount: 0 }, origin }
  const chat = play(
    emptyChat,
    { type: 'turn.started' },
    { type: 'text.delta', text: 'On it' },
    { type: 'user.message', ...message },
    { type: 'turn.finished', status: 'completed', text: 'On it' }
  )
  expect(texts(chat)).toEqual(['user:late event', 'assistant:On it'])
  expect(chat).toMatchObject({ running: false, queued: [] })
})
