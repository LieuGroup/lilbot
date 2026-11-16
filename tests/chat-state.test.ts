import { describe, expect, test } from 'bun:test'

import type { ChatEvent } from '../shared/chat-schema'
import { applyChatEvent, type ChatView, chatFromSnapshot, emptyChat, withUserMessage } from '../web/src/chat/chat-state'

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
    expect(chat.queued).toEqual(['second'])
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
    expect(chat.queued).toEqual(['second'])
  })
})

describe('joining a chat that is already running', () => {
  test('uses the full final text when only the end of the reply was streamed here', () => {
    const snapshot = chatFromSnapshot({ chatId: 'c1', botId: 'b', title: '', running: true, items: [{ kind: 'user', text: 'write' }] })
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
