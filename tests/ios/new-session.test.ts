import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildTranscriptRows } from '../../ios/src/chat/message-rows'
import { canTriggerNewSession, confirmNewSessionSnapshot, optimisticNewSession } from '../../ios/src/chat/new-session'
import { ChatSessionManager, type ChatSessionSocket } from '../../ios/src/chat/session-manager'
import { type ChatSlot, emptySlot } from '../../ios/src/chat/store'
import type { ChatEvent, ChatSnapshot } from '../../shared/chat-schema'
import { emptyChat } from '../../shared/client/chat/chat-state'
import { sessionTime } from '../../shared/client/history/history-labels'

const IOS_SRC = join(import.meta.dir, '../../ios/src')

function makePendingHarness() {
  const slots = new Map<string, ChatSlot>()
  const calls: Array<{ method: string; botId: string }> = []
  let seq = 0
  let resolvePendingNew: ((snapshot: ChatSnapshot) => void) | null = null

  const fake: ChatSessionSocket = {
    connected: true,
    call(method: string, params: Record<string, unknown>) {
      calls.push({ method, botId: String(params.botId ?? '') })
      if (method === 'chat.open') {
        seq += 1
        return Promise.resolve({
          chatId: `chat-${seq}`,
          botId: String(params.botId),
          title: '',
          running: false,
          workspace: '',
          items: [{ kind: 'user', text: 'Earlier message' }],
          history: {
            items: [{ id: 'row-1', sessionId: `chat-${seq}`, at: 1_700_000_000_000, author: 'user', item: { kind: 'user', text: 'Earlier message' } }],
            nextCursor: null,
            start: { at: 1_700_000_000_000 },
            import: { complete: true, sessions: 1, completed: 1, items: 1 }
          }
        }) as Promise<never>
      }
      if (method === 'chat.new') {
        return new Promise<ChatSnapshot>(resolve => {
          resolvePendingNew = resolve
        }) as Promise<never>
      }
      if (method === 'chat.history') {
        return Promise.resolve({ items: [], nextCursor: null, start: null, import: { complete: true, sessions: 0, completed: 0, items: 0 } }) as Promise<never>
      }
      return Promise.resolve({ ok: true }) as Promise<never>
    },
    onChat(_chatId: string, _listener: (event: ChatEvent) => void) {
      return () => {}
    }
  }

  const getSlot = (botId: string) => slots.get(botId) ?? emptySlot
  const updateSlot = (botId: string, change: (slot: ChatSlot) => ChatSlot) => {
    slots.set(botId, change(getSlot(botId)))
  }

  const manager = new ChatSessionManager({
    getSocket: () => fake,
    getSlot,
    updateSlot,
    newMessageId: () => 'msg-1',
    getDeviceId: async () => 'dev-1',
    releaseGraceMs: 25
  })
  manager.setConnected(true)

  return {
    calls,
    manager,
    getSlot,
    resolveNew: (snapshot: ChatSnapshot) => {
      const done = resolvePendingNew
      resolvePendingNew = null
      done?.(snapshot)
    }
  }
}

describe('new session divider on empty new session and double-tap guard', () => {
  test('canTriggerNewSession blocks while disconnected, not ready, already opening, or without chatId', () => {
    expect(canTriggerNewSession({ connected: true, ready: true, opening: false, chatId: 'chat-1' })).toBe(true)
    expect(canTriggerNewSession({ connected: true, ready: true, opening: true, chatId: 'chat-1' })).toBe(false)
    expect(canTriggerNewSession({ connected: true, ready: false, opening: false, chatId: 'chat-1' })).toBe(false)
    expect(canTriggerNewSession({ connected: false, ready: true, opening: false, chatId: 'chat-1' })).toBe(false)
    expect(canTriggerNewSession({ connected: true, ready: true, opening: false, chatId: '' })).toBe(false)
  })

  test('empty new session renders the New session divider with exact web time & bot explanation', () => {
    const startedAt = Date.UTC(2026, 10, 25, 6, 15, 0)
    const emptySnapshotWithHistory: ChatSnapshot = {
      chatId: 'chat-empty-2',
      botId: 'bot-a',
      title: '',
      running: false,
      workspace: '',
      items: [],
      history: {
        items: [{ id: 'session:chat-empty-2', sessionId: 'chat-empty-2', at: startedAt, author: 'system', item: { kind: 'session', text: 'New session' } }],
        nextCursor: null,
        start: { at: startedAt - 60_000 },
        import: { complete: true, sessions: 2, completed: 2, items: 1 }
      }
    }

    const view = confirmNewSessionSnapshot(emptySnapshotWithHistory, emptyChat, startedAt)
    const rows = buildTranscriptRows(view, 'Chief of Staff', startedAt)
    const firstRow = rows[0]
    expect(firstRow).toEqual({
      kind: 'session',
      key: 'session:id:session:chat-empty-2',
      at: startedAt,
      reason: undefined,
      botName: 'Chief of Staff'
    })
    expect(firstRow?.kind === 'session' ? sessionTime(firstRow.at, startedAt) : '').toMatch(/^Today \d{2}:\d{2}$/)

    // Even when a server omits snapshot.history on an empty new session, the divider still renders.
    const noHistorySnapshot: ChatSnapshot = { chatId: 'chat-empty-3', botId: 'bot-a', title: '', running: false, workspace: '', items: [] }
    const fallbackView = confirmNewSessionSnapshot(noHistorySnapshot, emptyChat, startedAt)
    const fallbackRows = buildTranscriptRows(fallbackView, 'Chief of Staff', startedAt)
    expect(fallbackRows[0]).toEqual({
      kind: 'session',
      key: 'session:id:session:chat-empty-3',
      at: startedAt,
      reason: undefined,
      botName: 'Chief of Staff'
    })
  })

  test('optimisticNewSession stamps live timestamp so divider never shows stale mount time', () => {
    const now = Date.UTC(2026, 10, 25, 6, 20, 0)
    const view = optimisticNewSession({ ...emptyChat, items: [{ kind: 'user', id: 'u1', at: now - 3_600_000, text: 'hi' }] }, now)
    expect(view.items.at(-1)).toMatchObject({ kind: 'session', text: 'New session', at: now })
  })

  test('double-tap while a new session is starting is ignored and scrollToLatestSeq advances on start and confirm', async () => {
    const { calls, manager, getSlot, resolveNew } = makePendingHarness()
    const release = manager.acquire('bot-a')
    await Promise.resolve()
    await Promise.resolve()

    expect(getSlot('bot-a').ready).toBe(true)
    // Simulate user scrolled up before tapping the pencil.
    const scrolledSlot = getSlot('bot-a')
    expect(scrolledSlot.scrollToLatestSeq).toBe(0)

    // First tap starts chat.new immediately, adds timestamped divider, resets scroll, and marks not ready.
    expect(manager.newChat('bot-a')).toBe(true)
    expect(calls.filter(c => c.method === 'chat.new')).toHaveLength(1)
    expect(getSlot('bot-a').ready).toBe(false)
    expect(getSlot('bot-a').scrollToLatestSeq).toBe(1)
    expect(getSlot('bot-a').view.items.at(-1)).toMatchObject({ kind: 'session', text: 'New session' })
    expect(typeof getSlot('bot-a').view.items.at(-1)?.at).toBe('number')

    // Second and third taps while chat.new is in flight are strictly ignored.
    expect(manager.newChat('bot-a')).toBe(false)
    expect(manager.newChat('bot-a')).toBe(false)
    expect(calls.filter(c => c.method === 'chat.new')).toHaveLength(1)

    const confirmedAt = Date.UTC(2026, 10, 25, 6, 30, 0)
    resolveNew({
      chatId: 'chat-2',
      botId: 'bot-a',
      title: '',
      running: false,
      workspace: '',
      items: [],
      history: {
        items: [
          { id: 'row-1', sessionId: 'chat-1', at: confirmedAt - 120_000, author: 'user', item: { kind: 'user', text: 'Earlier message' } },
          { id: 'session:chat-2', sessionId: 'chat-2', at: confirmedAt, author: 'system', item: { kind: 'session', text: 'New session' } }
        ],
        nextCursor: null,
        start: { at: confirmedAt - 120_000 },
        import: { complete: true, sessions: 2, completed: 2, items: 2 }
      }
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(getSlot('bot-a').ready).toBe(true)
    expect(getSlot('bot-a').scrollToLatestSeq).toBe(2)
    expect(getSlot('bot-a').view.items.at(-1)).toMatchObject({ id: 'session:chat-2', kind: 'session', at: confirmedAt })
    release()
  })

  test('ordinary iPhone compact chat header includes New session pencil and HistoryMarks matches web wording', () => {
    const headerChrome = readFileSync(join(IOS_SRC, 'chat/chat-header-chrome.tsx'), 'utf8')
    const marks = readFileSync(join(IOS_SRC, 'history/history-marks.tsx'), 'utf8')
    expect(headerChrome).toContain('testID="chat-new-session-button"')
    expect(headerChrome).toContain('startNewChat(botId)')
    expect(marks).toContain('New session')
    expect(marks).toContain('starts fresh from here. It keeps its memory and can search what was said above.')
    expect(marks).toContain('sessionTime(at)')
  })
})
