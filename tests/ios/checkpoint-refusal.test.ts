import { describe, expect, test } from 'bun:test'
import { type CheckpointRefusalSocket, createCheckpointRefusalController } from '../../ios/src/memory/checkpoint-refusal-controller'
import type { CheckpointChoice, MemoryCheckpointRefusal } from '../../shared/memory-schema'

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

const samplePending: MemoryCheckpointRefusal = {
  botId: 'bot-atlas',
  chatId: 'chat-1',
  pieceKey: 'piece-abc',
  refusalCount: 2,
  singleMessage: true,
  pieceAt: Date.UTC(2026, 10, 25, 3, 40, 0),
  messagesBack: 12,
  usedTwoModels: true,
  firstRefusedAt: Date.UTC(2026, 10, 25, 3, 41, 0),
  lastRefusedAt: Date.UTC(2026, 10, 25, 3, 42, 0)
}

type ChooseResult = { ok: true; choice: CheckpointChoice; resumed: boolean; needsResend?: boolean }

function makeFakeSocket(initial: MemoryCheckpointRefusal | null) {
  let pending = initial
  let chooseImpl: (params: { choice: CheckpointChoice }) => Promise<ChooseResult> = async ({ choice }) => ({ ok: true, choice, resumed: choice === 'skip_piece' })
  const listeners = new Set<() => void>()
  const calls: { method: string; params: unknown }[] = []
  const socket: CheckpointRefusalSocket = {
    async call(method: string, params: unknown) {
      calls.push({ method, params })
      return method === 'memory.checkpointPending' ? pending : chooseImpl(params as { choice: CheckpointChoice })
    },
    onMemoryChanged(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  } as CheckpointRefusalSocket
  return {
    socket,
    calls,
    setPending: (next: MemoryCheckpointRefusal | null) => {
      pending = next
    },
    setChoose: (impl: typeof chooseImpl) => {
      chooseImpl = impl
    },
    emitMemoryChanged: () => {
      for (const listener of listeners) listener()
    },
    listenerCount: () => listeners.size
  }
}

describe('iOS pre-compress memory-save refusal controller', () => {
  test('loads pending refusal on sync and dismisses cross-device when memory.changed clears it', async () => {
    const fake = makeFakeSocket(samplePending)
    let newChats = 0
    const ctrl = createCheckpointRefusalController({
      getSocket: () => fake.socket,
      onState: () => {},
      onNewChat: () => {
        newChats += 1
      }
    })

    ctrl.sync({ botId: 'bot-atlas', chatId: 'chat-1', connected: true })
    await flush()
    expect(ctrl.getState().pending).toEqual(samplePending)
    expect(fake.listenerCount()).toBe(1)

    fake.setPending(null)
    fake.emitMemoryChanged()
    await flush()
    expect(ctrl.getState().pending).toBeNull()
    expect(ctrl.getState().settled).toBeNull()
    expect(newChats).toBe(0)

    ctrl.dispose()
    expect(fake.listenerCount()).toBe(0)
  })

  test('Compact & continue sets settled notice (auto-resume vs needsResend), guards double-tap, and clears on send', async () => {
    const fake = makeFakeSocket(samplePending)
    const deferred: { resolve: ((value: ChooseResult) => void) | null } = { resolve: null }
    fake.setChoose(
      () =>
        new Promise(resolve => {
          deferred.resolve = resolve
        })
    )

    const ctrl = createCheckpointRefusalController({ getSocket: () => fake.socket, onState: () => {}, onNewChat: () => {} })
    ctrl.sync({ botId: 'bot-atlas', chatId: 'chat-1', connected: true })
    await flush()

    const first = ctrl.choose('skip_piece', 'dev-iphone')
    const second = ctrl.choose('skip_piece', 'dev-iphone')
    expect(ctrl.getState().busy).toBe('skip_piece')
    expect(fake.calls.filter(c => c.method === 'memory.checkpointChoose')).toHaveLength(1)

    deferred.resolve?.({ ok: true, choice: 'skip_piece', resumed: false, needsResend: true })
    await Promise.all([first, second])
    expect(ctrl.getState().pending).toBeNull()
    expect(ctrl.getState().busy).toBeNull()
    expect(ctrl.getState().settled).toEqual({ needsResend: true })

    ctrl.clearSettled()
    expect(ctrl.getState().settled).toBeNull()
    ctrl.dispose()
  })

  test('Start a new session calls onNewChat without setting settled notice, and errors keep card open', async () => {
    const fake = makeFakeSocket(samplePending)
    let failNext = true
    fake.setChoose(async ({ choice }) => {
      if (failNext) {
        failNext = false
        throw new Error('Server busy')
      }
      return { ok: true, choice, resumed: false }
    })

    let newChats = 0
    const ctrl = createCheckpointRefusalController({
      getSocket: () => fake.socket,
      onState: () => {},
      onNewChat: () => {
        newChats += 1
      }
    })
    ctrl.sync({ botId: 'bot-atlas', chatId: 'chat-1', connected: true })
    await flush()

    await ctrl.choose('new_session', 'dev-iphone')
    expect(ctrl.getState().pending).toEqual(samplePending)
    expect(ctrl.getState().error).toBe('Server busy')
    expect(newChats).toBe(0)

    await ctrl.choose('new_session', 'dev-iphone')
    expect(ctrl.getState().pending).toBeNull()
    expect(ctrl.getState().settled).toBeNull()
    expect(ctrl.getState().error).toBe('')
    expect(newChats).toBe(1)
    ctrl.dispose()
  })

  test('switching bot or chat resets pending and settled state cleanly', async () => {
    const fake = makeFakeSocket(samplePending)
    const ctrl = createCheckpointRefusalController({ getSocket: () => fake.socket, onState: () => {}, onNewChat: () => {} })
    ctrl.sync({ botId: 'bot-atlas', chatId: 'chat-1', connected: true })
    await flush()
    await ctrl.choose('skip_piece')
    expect(ctrl.getState().settled).toEqual({ needsResend: undefined })

    fake.setPending(null)
    ctrl.sync({ botId: 'bot-atlas', chatId: 'chat-2', connected: true })
    await flush()
    expect(ctrl.getState().settled).toBeNull()
    expect(ctrl.getState().pending).toBeNull()
    ctrl.dispose()
  })
})
