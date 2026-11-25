import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { type CheckpointRefusalSocket, type CheckpointRefusalState, createCheckpointRefusalController } from '../../ios/src/memory/checkpoint-refusal-controller'
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

function makeFakeSocket(initial: MemoryCheckpointRefusal | null) {
  let pending = initial
  let chooseImpl: (params: { choice: CheckpointChoice }) => Promise<{ ok: true; choice: CheckpointChoice; resumed: boolean; needsResend?: boolean }> = async ({ choice }) => ({
    ok: true,
    choice,
    resumed: choice === 'skip_piece'
  })
  const listeners = new Set<() => void>()
  const calls: { method: string; params: unknown }[] = []

  const socket: CheckpointRefusalSocket = {
    async call(method: string, params: unknown) {
      calls.push({ method, params })
      if (method === 'memory.checkpointPending') return pending
      return chooseImpl(params as { choice: CheckpointChoice })
    },
    onMemoryChanged(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  } as CheckpointRefusalSocket

  return {
    socket,
    calls,
    setPending(next: MemoryCheckpointRefusal | null) {
      pending = next
    },
    setChoose(impl: typeof chooseImpl) {
      chooseImpl = impl
    },
    emitMemoryChanged() {
      for (const listener of listeners) listener()
    },
    listenerCount: () => listeners.size
  }
}

describe('iOS pre-compress memory-save refusal controller', () => {
  test('loads pending refusal on sync and dismisses cross-device when memory.changed clears it', async () => {
    const fake = makeFakeSocket(samplePending)
    const states: CheckpointRefusalState[] = []
    let newChats = 0
    const ctrl = createCheckpointRefusalController({
      getSocket: () => fake.socket,
      onState: next => states.push(next),
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
    const deferred: { resolve: ((value: { ok: true; choice: CheckpointChoice; resumed: boolean; needsResend?: boolean }) => void) | null } = { resolve: null }
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

const CARD_SSR_HARNESS = `
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { mock } from 'bun:test'
import * as React from 'react'
import { createElement } from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import * as ReactJsxDevRuntime from 'react/jsx-dev-runtime'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('react', () => React)
const iosReactDir = resolve(process.cwd(), 'ios/node_modules/react')
if (existsSync(iosReactDir)) {
  mock.module(resolve(iosReactDir, 'index.js'), () => React)
  mock.module(resolve(iosReactDir, 'jsx-runtime.js'), () => ReactJsxRuntime)
  mock.module(resolve(iosReactDir, 'jsx-dev-runtime.js'), () => ReactJsxDevRuntime)
}
const host = tag => ({ children, testID }) => createElement(tag, testID ? { 'data-testid': testID } : undefined, children)
mock.module('react-native', () => ({
  Pressable: host('rn-pressable'),
  Text: host('rn-text'),
  View: host('rn-view'),
  useColorScheme: () => 'light'
}))
mock.module('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }))
mock.module('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } }))

const { CheckpointRefusalCard } = await import(resolve(process.cwd(), 'ios/src/memory/checkpoint-refusal-card.tsx'))
const pending = { botId: 'bot-1', chatId: 'chat-1', pieceKey: 'k1', refusalCount: 2, singleMessage: true, pieceAt: null, messagesBack: 41, usedTwoModels: true, firstRefusedAt: 1, lastRefusedAt: 2 }
const card = renderToStaticMarkup(createElement(CheckpointRefusalCard, { pending, settled: null, busy: null, error: '', onChoose: () => {} }))
const settledOk = renderToStaticMarkup(createElement(CheckpointRefusalCard, { pending: null, settled: { needsResend: false }, busy: null, error: '', onChoose: () => {} }))
const settledResend = renderToStaticMarkup(createElement(CheckpointRefusalCard, { pending: null, settled: { needsResend: true }, busy: null, error: '', onChoose: () => {} }))
process.stdout.write(JSON.stringify({ card, settledOk, settledResend }))
`

describe('CheckpointRefusalCard shared copy rendering', () => {
  test('renders exact shared titles, Waiting for you status, Compact & continue button, and settled notices', () => {
    const out = JSON.parse(execFileSync(process.execPath, ['-e', CARD_SSR_HARNESS], { cwd: process.cwd(), encoding: 'utf8' })) as {
      card: string
      settledOk: string
      settledResend: string
    }
    expect(out.card).toContain('One message couldn’t be saved to memory')
    expect(out.card).toContain('Waiting for you')
    expect(out.card).toContain('from about 40 messages back')
    expect(out.card).toContain('Compact &amp; continue')
    expect(out.card).toContain('Start a new session')
    expect(out.settledOk).toContain('Continued without saving one earlier part.')
    expect(out.settledOk).not.toContain('Send your message again')
    expect(out.settledResend).toContain('Send your message again to continue.')
  })
})
