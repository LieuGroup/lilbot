/** PR 302 round 3: one shared keyboard helper for forms (Setup, Settings server address, rename device, Work), the
 *  "Make primary" and "Disconnect" in-flight guards, and real render checks of both Settings error-boundary wraps. */
import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { type BotActionsSocket, createBotActions } from '../../ios/src/bots/actions-core'
import { createConnectionStore } from '../../ios/src/connection/store-core'
import { collapseHeaderWhileTyping, focusedFieldMaxHeight, KEYBOARD_BAR_HEIGHT, revealScrollTarget } from '../../ios/src/ui/keyboard-sheet'
import { WORK_DONE_BAR_HEIGHT, revealScrollTarget as workReveal } from '../../ios/src/work/board-state'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')

describe('shared form keyboard rules', () => {
  test('a field under the keyboard bar scrolls up by exactly its overflow; one in view stays put', () => {
    const visibleBottom = 402 - 177 - KEYBOARD_BAR_HEIGHT
    expect(revealScrollTarget({ offset: 300, targetY: 150, targetHeight: 40, visibleBottom })).toBe(326)
    expect(revealScrollTarget({ offset: 300, targetY: 60, targetHeight: 40, visibleBottom })).toBeNull()
  })

  test('a field scrolled above the top of the scroll area comes back down, never past the start', () => {
    expect(revealScrollTarget({ offset: 400, targetY: 20, targetHeight: 40, visibleBottom: 300, visibleTop: 90 })).toBe(322)
    expect(revealScrollTarget({ offset: 30, targetY: -200, targetHeight: 40, visibleBottom: 300, visibleTop: 90 })).toBe(0)
  })

  test('a focused multiline field is capped to the room between the scroll top and the keyboard bar', () => {
    expect(focusedFieldMaxHeight({ scrollTop: 60, visibleBottom: 402 - 177 - KEYBOARD_BAR_HEIGHT })).toBe(96)
    expect(focusedFieldMaxHeight({ scrollTop: 300, visibleBottom: 310 })).toBe(48)
  })

  test('the Bot Details header folds only while typing in a short window', () => {
    expect(collapseHeaderWhileTyping(402, 177)).toBe(true)
    expect(collapseHeaderWhileTyping(678, 291)).toBe(true)
    expect(collapseHeaderWhileTyping(874, 336)).toBe(false)
    expect(collapseHeaderWhileTyping(402, 0)).toBe(false)
  })

  test('Work keeps using the same rule and bar height (one helper, not a third copy)', () => {
    expect(WORK_DONE_BAR_HEIGHT).toBe(KEYBOARD_BAR_HEIGHT)
    expect(workReveal).toBe(revealScrollTarget)
  })

  test('Setup, Settings and rename all host the shared reveal hook and keyboard bar with their primary action', () => {
    const files = [
      'ios/src/bots/setup-tab.tsx',
      'ios/src/settings/screen.tsx',
      'ios/src/computers/device-modals.tsx',
      'ios/src/work/work-today-page.tsx',
      'ios/src/work/work-item-page.tsx'
    ]
    for (const file of files) expect(read(file)).toContain("from '../ui/use-reveal-above-keyboard'")
    for (const file of files.slice(0, 3)) expect(read(file)).toContain('<KeyboardBar bottom={form.doneBarHeight}')
    expect(read('ios/src/bots/setup-form.tsx')).toContain("label: saving ? 'Saving…' : 'Save changes'")
    expect(read('ios/src/settings/server-section.tsx')).toContain("label: saving ? 'Saving…' : 'Save and connect'")
    expect(read('ios/src/bots/setup-tab.tsx')).not.toContain('automaticallyAdjustKeyboardInsets')
    expect(read('ios/src/app/(tabs)/(bots)/bot-details.tsx')).toContain('foldChrome && !verticalBarActive ? { ...screenOptions, headerShown: false }')
    expect(read('ios/src/app/(tabs)/(settings)/index.tsx')).toContain('headerShown: !foldChrome')
  })
})

describe('in-flight guards', () => {
  test('a second "Make primary" tap while one is in flight sends nothing more', async () => {
    let release!: () => void
    const sent: string[] = []
    const socket = {
      call: (method: string, params: { botId: string }) => {
        sent.push(`${method}:${params.botId}`)
        return sent.length === 1 ? new Promise<void>(done => (release = done)) : Promise.resolve()
      }
    } as unknown as BotActionsSocket
    const actions = createBotActions({ getSocket: () => socket, reload: async () => {}, upsert: () => {}, setError: () => {} })
    const first = actions.makeBotPrimary('a')
    const second = actions.makeBotPrimary('a')
    expect(sent).toEqual(['bots.setPrimary:a'])
    release()
    await Promise.all([first, second])
    await actions.makeBotPrimary('b')
    expect(sent).toEqual(['bots.setPrimary:a', 'bots.setPrimary:b'])
  })

  test('a second "Disconnect" while one runs stops the socket and clears the token once', async () => {
    let stops = 0
    let deletes = 0
    let release!: () => void
    const plain = { getItem: async () => null, setItem: () => new Promise<void>(done => (release = done)) }
    const secret = {
      getItem: async () => null,
      setItem: async () => {},
      deleteItem: async () => {
        deletes += 1
      }
    }
    const store = createConnectionStore({
      plain,
      secret,
      onDisconnect: () => {
        stops += 1
      }
    })
    const first = store.getState().disconnect()
    const second = store.getState().disconnect()
    release()
    await Promise.all([first, second])
    expect({ stops, deletes }).toEqual({ stops: 1, deletes: 1 })
  })
})

const WRAP_HARNESS = `
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
const { SettingsSectionList, SettingsSectionPage } = await import(resolve(process.cwd(), 'ios/src/settings/section-list.tsx'))
const { SettingsSectionErrorBoundary } = await import(resolve(process.cwd(), 'ios/src/settings/section-error-boundary.tsx'))
const Boom = () => { throw new Error('section failed') }
const Fine = () => createElement('rn-text', null, 'Fine section')
const def = (id, group, Component, DetailScreen) => ({ id, order: 1, group, Component, DetailScreen })
const wrapped = el => {
  const found = []
  const walk = (node, inside) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(n => walk(n, inside))
    const isBoundary = node.type === SettingsSectionErrorBoundary
    if (typeof node.type === 'function' && node.type !== SettingsSectionErrorBoundary && !node.type.prototype?.render && [Boom, Fine].includes(node.type)) found.push(inside)
    walk(node.props?.children, inside || isBoundary)
  }
  walk(el, false)
  return found
}
const list = SettingsSectionList({ navSections: [def('nav', 'navigation', Boom)], inlineSections: [def('inline', 'inline', Fine)], navigate: () => {}, connected: true })
const page = SettingsSectionPage({ section: def('page', 'navigation', Fine, Boom) })
process.stdout.write(JSON.stringify({ list: wrapped(list), page: page?.type === SettingsSectionErrorBoundary, pageId: page?.props.sectionId, fine: renderToStaticMarkup(createElement(SettingsSectionList, { navSections: [], inlineSections: [def('inline', 'inline', Fine)], navigate: () => {}, connected: true })) }))
`

describe('Settings error boundaries', () => {
  test('both Settings wraps hold every registered section and its pushed page inside a boundary', () => {
    const out = JSON.parse(execFileSync(process.execPath, ['-e', WRAP_HARNESS], { cwd: process.cwd(), encoding: 'utf8' })) as {
      list: boolean[]
      page: boolean
      pageId: string
      fine: string
    }
    expect(out.list).toEqual([true, true])
    expect(out.page).toBe(true)
    expect(out.pageId).toBe('page')
    expect(out.fine).toContain('Fine section')
    expect(read('ios/src/settings/screen.tsx')).toContain('<SettingsSectionList')
    expect(read('ios/src/app/(tabs)/(settings)/[section].tsx')).toContain('<SettingsSectionPage section={entry} />')
  })
})
