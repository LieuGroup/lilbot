import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'

interface SeamRenderResult {
  baseline: string
  explicitUndefined: string
  withSeam: string
  passthrough: string
  seenTools: string[]
  readOnlyItem: string
  interactiveItem: string
}

const HARNESS = `
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { mock } from 'bun:test'
import * as React from 'react'
import { createElement } from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import * as ReactJsxDevRuntime from 'react/jsx-dev-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { emptyChat } from './shared/client/chat/chat-state.ts'

globalThis.__DEV__ = false
mock.module('react', () => React)
const iosReactDir = resolve(process.cwd(), 'ios/node_modules/react')
if (existsSync(iosReactDir)) {
  mock.module(resolve(iosReactDir, 'index.js'), () => React)
  mock.module(resolve(iosReactDir, 'jsx-runtime.js'), () => ReactJsxRuntime)
  mock.module(resolve(iosReactDir, 'jsx-dev-runtime.js'), () => ReactJsxDevRuntime)
}
const host = tag => ({ children, testID, ...rest }) => {
  const props = {}
  if (testID) props['data-testid'] = testID
  if (typeof rest.accessibilityLabel === 'string') props['data-a11y-label'] = rest.accessibilityLabel
  return createElement(tag, props, children)
}
mock.module('react-native', () => ({
  AccessibilityInfo: { isReduceMotionEnabled: async () => false, isReduceTransparencyEnabled: async () => false, isScreenReaderEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
  ActivityIndicator: host('rn-spinner'),
  Animated: { Value: class { setValue() {} }, View: host('rn-animated-view'), loop: () => ({ start() {}, stop() {} }), sequence: () => ({}), timing: () => ({}) },
  Easing: { inOut: x => x, ease: x => x },
  FlatList: ({ data, renderItem, ListHeaderComponent, ListEmptyComponent, testID }) =>
    createElement('rn-flatlist', testID ? { 'data-testid': testID } : undefined, ListHeaderComponent, data.length === 0 ? ListEmptyComponent : data.map((item, index) => createElement('rn-row', { key: index }, renderItem({ item, index })))),
  Image: host('rn-image'),
  Keyboard: { addListener: () => ({ remove() {} }), dismiss() {} },
  KeyboardAvoidingView: host('rn-kav'),
  Modal: ({ visible, children }) => (visible ? createElement('rn-modal', null, children) : null),
  Platform: { OS: 'ios', select: o => o.ios ?? o.default },
  Pressable: host('rn-pressable'),
  ScrollView: host('rn-scrollview'),
  StyleSheet: { create: s => s },
  Text: host('rn-text'),
  TextInput: host('rn-textinput'),
  View: host('rn-view'),
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 })
}))
mock.module('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }) }))
mock.module('react-native-markdown-display', () => ({ default: ({ children }) => createElement('rn-markdown', null, children) }))
mock.module('react-native-svg', () => ({ default: host('rn-svg'), Svg: host('rn-svg'), G: host('rn-g'), Path: host('rn-path'), Polygon: host('rn-polygon'), Circle: host('rn-circle'), Rect: host('rn-rect'), Line: host('rn-line'), Polyline: host('rn-polyline') }))
mock.module('expo-haptics', () => ({ ImpactFeedbackStyle: { Light: 'light' }, impactAsync: async () => {} }))
mock.module('expo-clipboard', () => ({ setStringAsync: async () => {} }))
mock.module('expo-status-bar', () => ({ useVerticalBarEdgeIOS: () => null }))
mock.module('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }))
mock.module('expo-glass-effect', () => ({ GlassView: host('rn-glass'), isGlassEffectAPIAvailable: () => false, isLiquidGlassAvailable: () => false }))
mock.module('expo-image-picker', () => ({ requestMediaLibraryPermissionsAsync: async () => ({ granted: true }), launchImageLibraryAsync: async () => ({ canceled: true }) }))
mock.module('expo-document-picker', () => ({ getDocumentAsync: async () => ({ canceled: true }) }))
mock.module('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000000' }))
mock.module('expo-file-system', () => ({ File: class {} }))
mock.module('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }))
mock.module('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } }))

const { useChatStore } = await import(resolve(process.cwd(), 'ios/src/chat/store.ts'))
const { ChatItem } = await import(resolve(process.cwd(), 'ios/src/chat/message-item.tsx'))
const { ChatScreen } = await import(resolve(process.cwd(), 'ios/src/chat/screen.tsx'))

const bot = {
  id: 'bot-1', name: 'Atlas', function: 'General assistant', model: null, reasoningEffort: null,
  permissionMode: 'full-access', isDefault: true, isPrimary: true, runnable: true, workspace: '/tmp/atlas',
  prefs: { avatar: { shape: 'circle', color: 'slate', faceColor: 'ink' }, sectionId: null, pinned: false, pinnedAt: null, hidden: false }
}
const sampleChat = {
  ...emptyChat,
  items: [
    { kind: 'user', id: 'u1', at: Date.UTC(2026, 10, 24, 9, 59, 0), text: 'Check this' },
    { kind: 'tool', id: 't1', toolId: 'call-1', at: Date.UTC(2026, 10, 24, 10, 0, 0), name: 'lilbot_delegate', detail: 'Ask Researcher', running: false, failed: false },
    { kind: 'assistant', id: 'a1', at: Date.UTC(2026, 10, 24, 10, 1, 0), text: 'Done.' }
  ],
  start: Date.UTC(2026, 10, 24, 9, 59, 0)
}
const slot = { view: sampleChat, ready: true, error: '', draft: '', scrollOffset: 0, scrollAnchor: null }
useChatStore.getInitialState().slots[bot.id] = slot
useChatStore.setState(state => ({ slots: { ...state.slots, [bot.id]: slot } }))

const seenTools = []
const baseline = renderToStaticMarkup(createElement(ChatScreen, { bot }))
const explicitUndefined = renderToStaticMarkup(createElement(ChatScreen, { bot, dock: undefined, renderToolItem: undefined }))
const withSeam = renderToStaticMarkup(createElement(ChatScreen, {
  bot,
  dock: createElement('rn-dock', { 'data-testid': 'tasks-dock' }, '2 active tasks'),
  renderToolItem: (item, fallback) => {
    seenTools.push(item.name)
    return item.name === 'lilbot_delegate' ? createElement('rn-delegation-card', { 'data-testid': 'custom-tool-card' }, 'Delegated: ' + item.detail) : fallback
  }
}))
const passthrough = renderToStaticMarkup(createElement(ChatScreen, { bot, renderToolItem: (_item, fallback) => fallback }))

const userItem = {
  kind: 'user', id: 'u-ro', at: Date.UTC(2026, 10, 24, 10, 0, 0), text: 'Please review',
  images: { support: 'unsupported', imageCount: 1 }, origin: { deviceId: 'dev-other', name: 'MacBook' }
}
const readOnlyItem = renderToStaticMarkup(createElement(ChatItem, { item: userItem, botName: 'Atlas' }))
const interactiveItem = renderToStaticMarkup(createElement(ChatItem, { item: userItem, botName: 'Atlas', deviceId: 'dev-this', onChangeModel: () => {} }))

process.stdout.write(JSON.stringify({ baseline, explicitUndefined, withSeam, passthrough, seenTools, readOnlyItem, interactiveItem }))
`

function renderSeam(): SeamRenderResult {
  const raw = execFileSync(process.execPath, ['-e', HARNESS], { cwd: process.cwd(), encoding: 'utf8' })
  return JSON.parse(raw) as SeamRenderResult
}

describe('iOS ChatScreen and ChatItem seams for tasks dock and read-only exchanges', () => {
  const rendered = renderSeam()

  test('ChatScreen renders identically when optional dock and renderToolItem are omitted', () => {
    expect(rendered.baseline).toBe(rendered.explicitUndefined)
    expect(rendered.passthrough).toBe(rendered.baseline)
    expect(rendered.baseline).toContain('lilbot_delegate')
    expect(rendered.baseline).toContain('Ask Researcher')
    expect(rendered.baseline).toMatch(/<\/rn-flatlist><\/rn-view><rn-view><rn-view data-testid="composer-resting"/)
  })

  test('ChatScreen renders supplied dock directly above composer inside KeyboardAvoidingView and invokes renderToolItem', () => {
    expect(rendered.seenTools).toEqual(['lilbot_delegate'])
    expect(rendered.withSeam).toContain('data-testid="tasks-dock"')
    expect(rendered.withSeam).toContain('2 active tasks')
    const kavStart = rendered.withSeam.indexOf('<rn-kav>')
    const listEnd = rendered.withSeam.indexOf('</rn-flatlist>')
    const dockIdx = rendered.withSeam.indexOf('data-testid="tasks-dock"')
    const composerIdx = rendered.withSeam.indexOf('data-testid="composer-resting"')
    const kavEnd = rendered.withSeam.indexOf('</rn-kav>')
    expect(kavStart).toBeGreaterThan(-1)
    expect(dockIdx).toBeGreaterThan(listEnd)
    expect(dockIdx).toBeLessThan(composerIdx)
    expect(composerIdx).toBeLessThan(kavEnd)
    expect(rendered.withSeam).toContain('data-testid="custom-tool-card"')
    expect(rendered.withSeam).toContain('Delegated: Ask Researcher')
    expect(rendered.withSeam).not.toContain('lilbot_delegate')
  })

  test('ChatItem works read-only when deviceId and onChangeModel are omitted', () => {
    expect(rendered.readOnlyItem).toContain('Please review')
    expect(rendered.readOnlyItem).not.toContain('from MacBook')
    expect(rendered.readOnlyItem).not.toContain('Change model')
    expect(rendered.interactiveItem).toContain('from MacBook')
    expect(rendered.interactiveItem).toContain('Change model')
  })
})
