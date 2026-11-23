import { describe, expect, test } from 'bun:test'
import { ChatSessionManager, type ChatSessionSocket } from '../../ios/src/chat/session-manager'
import { type ChatSlot, emptySlot, useChatStore } from '../../ios/src/chat/store'
import type { ChatEvent, ChatSnapshot } from '../../shared/chat-schema'
import { emptyChat } from '../../shared/client/chat/chat-state'

function makeFakeSocket() {
  let nextId = 1
  const calls: { method: string; params: Record<string, unknown> }[] = []
  const listeners = new Map<string, (event: ChatEvent) => void>()

  const socket: ChatSessionSocket = {
    connected: true,
    async call(method: string, params: Record<string, unknown>) {
      calls.push({ method, params })
      if (method === 'chat.open' || method === 'chat.new') {
        const snapshot: ChatSnapshot = { chatId: `chat-${nextId++}`, botId: String(params.botId), title: '', running: false, workspace: '', items: [] }
        return snapshot as never
      }
      if (method === 'chat.history') {
        return { items: [], hasMore: false, nextCursor: null } as never
      }
      return { ok: true } as never
    },
    onChat(chatId, listener) {
      listeners.set(chatId, listener)
      return () => {
        if (listeners.get(chatId) === listener) listeners.delete(chatId)
      }
    }
  }

  return {
    socket,
    calls,
    emit(chatId: string, event: ChatEvent) {
      listeners.get(chatId)?.(event)
    }
  }
}

function makeHarness(releaseGraceMs = 40) {
  const fake = makeFakeSocket()
  const slots = new Map<string, ChatSlot>()
  const getSlot = (botId: string) => slots.get(botId) ?? { ...emptySlot, view: emptyChat }
  const updateSlot = (botId: string, change: (slot: ChatSlot) => ChatSlot) => {
    slots.set(botId, change(getSlot(botId)))
  }
  const manager = new ChatSessionManager({
    getSocket: () => fake.socket,
    getSlot,
    updateSlot,
    newMessageId: () => 'msg-1',
    getDeviceId: async () => 'dev-1',
    releaseGraceMs,
    reopenDelayMs: 50
  })
  manager.setConnected(true)
  return { fake, manager, getSlot, updateSlot }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 10))

describe('ChatSessionManager fold/unfold continuity', () => {
  test('fold handoff (unmount split -> mount compact /chat) keeps one open session and zero dropped events', async () => {
    const { fake, manager, getSlot } = makeHarness(80)
    const releaseSplit = manager.acquire('bot-a')
    await flush()
    expect(manager.activeChatId('bot-a')).toBe('chat-1')
    expect(getSlot('bot-a').ready).toBe(true)

    // Fold unmounts split ChatScreen first; streaming delta arrives mid-transition before /chat mounts.
    releaseSplit()
    fake.emit('chat-1', { type: 'text.delta', text: 'streaming across fold' })
    const releaseCompact = manager.acquire('bot-a')
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(fake.calls.filter(c => c.method === 'chat.open')).toHaveLength(1)
    expect(fake.calls.filter(c => c.method === 'chat.close')).toHaveLength(0)
    expect(manager.activeChatId('bot-a')).toBe('chat-1')
    expect(getSlot('bot-a').ready).toBe(true)
    const assistant = getSlot('bot-a').view.items.find(item => item.kind === 'assistant')
    expect(assistant?.kind === 'assistant' ? assistant.text : '').toBe('streaming across fold')
    releaseCompact()
  })

  test('unfold overlap (mount split while /chat is mounted, then unmount /chat) keeps one open session', async () => {
    const { fake, manager } = makeHarness(30)
    const releaseCompact = manager.acquire('bot-a')
    await flush()
    const releaseSplit = manager.acquire('bot-a')
    releaseCompact()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(fake.calls.filter(c => c.method === 'chat.open')).toHaveLength(1)
    expect(fake.calls.filter(c => c.method === 'chat.close')).toHaveLength(0)
    expect(manager.activeChatId('bot-a')).toBe('chat-1')
    releaseSplit()
  })

  test('closing all views releases and calls chat.close after the grace window', async () => {
    const { fake, manager, getSlot } = makeHarness(25)
    const release = manager.acquire('bot-a')
    await flush()
    release()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(fake.calls.filter(c => c.method === 'chat.close')).toHaveLength(1)
    expect(manager.activeChatId('bot-a')).toBe('')
    expect(getSlot('bot-a').ready).toBe(false)
  })

  test('disconnect marks not ready and reconnect reopens an acquired bot automatically', async () => {
    const { fake, manager, getSlot } = makeHarness(30)
    const release = manager.acquire('bot-a')
    await flush()
    expect(manager.activeChatId('bot-a')).toBe('chat-1')

    manager.setConnected(false)
    expect(getSlot('bot-a').ready).toBe(false)
    expect(manager.activeChatId('bot-a')).toBe('')

    manager.setConnected(true)
    await flush()
    expect(manager.activeChatId('bot-a')).toBe('chat-2')
    expect(getSlot('bot-a').ready).toBe(true)
    expect(fake.calls.filter(c => c.method === 'chat.open')).toHaveLength(2)
    release()
  })

  test('useChatStore persists per-bot drafts and clamps scroll offsets across fold/unfold', () => {
    const store = useChatStore.getState()
    store.setDraft('bot-draft', 'half-written reply')
    store.setScrollOffset('bot-draft', 340)
    expect(useChatStore.getState().slots['bot-draft']?.draft).toBe('half-written reply')
    expect(useChatStore.getState().slots['bot-draft']?.scrollOffset).toBe(340)

    store.setScrollOffset('bot-draft', -24)
    expect(useChatStore.getState().slots['bot-draft']?.scrollOffset).toBe(0)
  })
})
