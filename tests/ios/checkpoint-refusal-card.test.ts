import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'

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
mock.module('react-native', () => ({ Pressable: host('rn-pressable'), Text: host('rn-text'), View: host('rn-view'), useColorScheme: () => 'light' }))
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
