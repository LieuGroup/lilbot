import { describe, expect, test } from 'bun:test'
import { applyChatEvent, chatFromHistory, chatFromSnapshot, emptyChat, withNewSession } from '../../shared/client/chat/chat-state'
import { withSentMessage, withUserMessage } from '../../shared/client/chat/user-messages'
import type { HistoryPage } from '../../shared/history-schema'
import { play, snapshot, texts } from './chat-helpers'

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

  test("the server's record of an unknown message id leaves the chat as it is", () => {
    const sent = withUserMessage(emptyChat, 'plain')
    expect(withSentMessage(sent, record('other'))).toBe(sent)
  })

  test('a queued message keeps its files and joins the transcript with them', () => {
    let chat = play(withUserMessage(emptyChat, 'first'), { type: 'turn.started' })
    chat = withUserMessage(chat, { kind: 'user', text: '', messageId: 'm2', attachments: [file('b')] })
    chat = withSentMessage(chat, { ...record('m2', 'unknown'), text: '', attachments: [file('b')] })
    expect(chat.queued[0]).toMatchObject({ messageId: 'm2', images: { support: 'unknown' } })
    expect(chat.items.at(-1)).toMatchObject({ kind: 'user', messageId: 'm2', attachments: [{ id: 'b' }], images: { support: 'unknown' } })
    chat = play(chat, { type: 'text.delta', text: 'one' }, { type: 'turn.finished', status: 'completed', text: 'one' }, { type: 'turn.started' })
    expect(texts(chat)).toEqual(['user:first', 'user:', 'assistant:one'])
    expect(chat.queued).toEqual([])
  })
})

describe('opening a chat', () => {
  type Row = HistoryPage['items'][number]['item']
  const page = (sessionId: string, items: Row[], ids = items.map((_, n) => `r${n}`)): HistoryPage => ({
    items: items.map((item, n) => ({ id: ids[n], sessionId, at: n, author: item.kind === 'user' ? 'user' : 'bot', item })),
    nextCursor: null,
    start: null,
    import: { complete: true, sessions: 1, completed: 1, items: items.length }
  })

  test('shows the saved conversation with its session dividers, named after its latest session', () => {
    const chat = chatFromHistory(
      page('main', [
        { kind: 'user', text: 'old' },
        { kind: 'session', text: 'New session' },
        { kind: 'user', text: 'hi' },
        { kind: 'assistant', text: 'hello' }
      ])
    )
    expect(chat).toMatchObject({ chatId: 'main', running: false, load: 1 })
    expect(texts(chat)).toEqual(['user:old', 'session:New session', 'user:hi', 'assistant:hello'])
    expect(chat.items[2]).toMatchObject({ id: 'r2', at: 2 })
  })

  test('the snapshot keeps the objects of unchanged items and counts as a new load', () => {
    const shown = chatFromHistory(
      page('main', [
        { kind: 'user', text: 'hi' },
        { kind: 'assistant', text: 'hello' }
      ])
    )
    const opened = chatFromSnapshot(
      snapshot(
        page('main', [
          { kind: 'user', text: 'hi' },
          { kind: 'assistant', text: 'hello, edited' },
          { kind: 'user', text: 'new' }
        ])
      ),
      shown
    )
    expect(opened.items[0]).toBe(shown.items[0])
    expect(opened.items[1]).not.toBe(shown.items[1])
    expect(texts(opened)).toEqual(['user:hi', 'assistant:hello, edited', 'user:new'])
    expect(opened.load).toBe(2)
  })

  test('a chat without history keeps its own transcript', () => {
    const opened = chatFromSnapshot({ chatId: 'run', botId: 'b', title: '', running: false, workspace: '', items: [{ kind: 'user', text: 'routine' }] })
    expect(texts(opened)).toEqual(['user:routine'])
    expect(opened).toMatchObject({ older: null, start: null, importing: false })
  })

  test('a new session adds a divider and keeps the conversation', () => {
    let chat = chatFromHistory(page('main', [{ kind: 'user', text: 'hi' }]))
    chat = play(withUserMessage(chat, 'more'), { type: 'turn.started' }, { type: 'text.delta', text: 'par' })
    chat = withNewSession(chat)
    expect(texts(chat)).toEqual(['user:hi', 'user:more', 'assistant:par', 'session:New session'])
    expect(chat.items[2]).toMatchObject({ streaming: false })
    expect(chat).toMatchObject({ running: false, activity: '', queued: [] })
    // The new session's snapshot brings the saved divider in place of the one drawn at once.
    const opened = chatFromSnapshot(
      snapshot(
        page(
          'new',
          [
            { kind: 'user', text: 'hi' },
            { kind: 'user', text: 'more' },
            { kind: 'assistant', text: 'part' },
            { kind: 'session', text: 'New session' }
          ],
          ['r0', 'r1', 'r2', 'session:new']
        )
      ),
      chat
    )
    expect(texts(opened)).toEqual(['user:hi', 'user:more', 'assistant:part', 'session:New session'])
    expect(opened.items[0]).toBe(chat.items[0])
    expect(opened.items[3]).toMatchObject({ id: 'session:new' })
  })

  test('an empty chat gets no divider', () => {
    expect(withNewSession(emptyChat).items).toEqual([])
  })
})
