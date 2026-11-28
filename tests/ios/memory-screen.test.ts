/** iPhone Settings > Memory: the pushed pages and their params, titles, the first shared facts before "Show N more",
 *  the bots that know facts of their own, who a new fact is saved under, the Duo strip for each page, and the wiring
 *  that keeps the screen on the web's calls, wording and the shared keyboard helper. */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildDuoVerticalBarItems, DUO_VERTICAL_BAR_TABLE, DUO_VERTICAL_ITEM_PREFIX } from '../../ios/src/duo/vertical-bar'
import { factBreadcrumb, factOwners, memoryRoute, memoryRouteParams, memoryStripScreen, memoryTitle, newFactOwner, sharedShown } from '../../ios/src/memory/memory-view'
import type { Bot } from '../../shared/bot-schema'
import type { MemoryFact } from '../../shared/memory-schema'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')

const fact = (id: string, over: Partial<MemoryFact> = {}): MemoryFact => ({
  id,
  botId: 'b1',
  kind: 'profile',
  scope: 'shared',
  text: `Fact ${id}`,
  author: 'bot',
  via: 'chat',
  learnedAt: 0,
  paused: false,
  expiresAt: null,
  forgottenAt: null,
  forgottenBy: null,
  ...over
})

describe('iPhone Settings > Memory', () => {
  test('Memory is registered at slot 30 as a navigation row with its own pushed route', () => {
    expect(read('ios/src/settings/sections/index.ts')).toContain('[computersSettingsSection, memorySettingsSection, generalSettingsSection]')
    const section = read('ios/src/settings/sections/memory-section.tsx')
    for (const part of ["id: 'memory'", 'order: 30', "group: 'navigation'", "routeName: 'memory'", "routeTitle: 'Memory'", 'DetailScreen: MemoryScreen'])
      expect(section).toContain(part)
  })

  test('every page round-trips through the [section] route params, and unknown params open Memory itself', () => {
    for (const route of [{ view: 'main' }, { view: 'bot', botId: 'b1', name: 'Atlas' }, { view: 'removed' }, { view: 'fact', factId: 'f1' }] as const) {
      const params = memoryRouteParams(route)
      expect(params.section).toBe('memory')
      expect(memoryRoute(params)).toEqual(route)
    }
    expect(memoryRoute({ section: 'memory', view: 'bot' })).toEqual({ view: 'main' })
    expect(memoryRoute({ section: 'memory', view: 'fact' })).toEqual({ view: 'main' })
    expect(memoryRoute({ section: 'memory', view: ['bot', 'removed'] })).toEqual({ view: 'main' })
  })

  test('titles and the opened fact breadcrumb use the shared wording', () => {
    expect(memoryTitle({ view: 'main' })).toBe('Memory')
    expect(memoryTitle({ view: 'removed' })).toBe('Removed facts')
    expect(memoryTitle({ view: 'bot', botId: 'b1', name: 'Atlas' })).toBe('Atlas')
    expect(memoryTitle({ view: 'bot', botId: 'b1', name: 'Atlas' }, 'Atlas II')).toBe('Atlas II')
    expect(factBreadcrumb(fact('f1')).join(' › ')).toBe('Memory › Shared with all your bots')
    expect(factBreadcrumb(fact('f1', { scope: 'bot' })).join(' › ')).toBe('Memory › Known by one bot only')
  })

  test('five shared facts show first; "Show N more" counts from the page total, and expanding shows every loaded fact', () => {
    const facts = Array.from({ length: 8 }, (_, i) => fact(`f${i}`))
    expect(sharedShown(facts, 24, false)).toMatchObject({ hidden: 19 })
    expect(sharedShown(facts, 24, false).shown.map(f => f.id)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4'])
    expect(sharedShown(facts, 24, true)).toMatchObject({ hidden: 16 })
    expect(sharedShown(facts.slice(0, 3), 3, false)).toMatchObject({ hidden: 0 })
  })

  test('one-bot owners are only bots with facts, by name, and the section count is their sum', () => {
    const { owners, total } = factOwners([
      { botId: 'p', name: 'Pulse', deleted: false, facts: 3 },
      { botId: 'o', name: 'Old Bot', deleted: true, facts: 1 },
      { botId: 'z', name: 'Zero', deleted: false, facts: 0 },
      { botId: 'a', name: 'Atlas', deleted: false, facts: 5 }
    ])
    expect(owners.map(o => o.name)).toEqual(['Atlas', 'Old Bot', 'Pulse'])
    expect(total).toBe(9)
  })

  test('a shared fact is saved under the primary bot and a one-bot fact under the chosen bot, as on the web', () => {
    const bots = [
      { id: 'a', isPrimary: false },
      { id: 'chief', isPrimary: true }
    ] as Bot[]
    expect(newFactOwner(bots, true, 'a')).toBe('chief')
    expect(newFactOwner(bots, false, 'a')).toBe('a')
    expect(newFactOwner(bots, false, '')).toBe('chief')
    expect(newFactOwner([], true, '')).toBe('')
  })

  test('the Duo strip holds Search and Add on Memory, Pause and Forget on an opened fact, and Back alone elsewhere', () => {
    expect(memoryStripScreen({ view: 'main' })).toBe('memory')
    expect(memoryStripScreen({ view: 'fact', factId: 'f1' })).toBe('memory-fact')
    expect(memoryStripScreen({ view: 'removed' })).toBeNull()
    expect(memoryStripScreen({ view: 'bot', botId: 'b1', name: 'Atlas' })).toBeNull()
    expect(DUO_VERTICAL_BAR_TABLE.memory.map(s => s.id)).toEqual(['search-memory', 'add-fact'])
    expect(DUO_VERTICAL_BAR_TABLE['memory-fact'].map(s => s.id)).toEqual(['pause-fact', 'forget-fact'])

    const noop = () => {}
    const main = buildDuoVerticalBarItems({ screen: 'memory', actions: { 'search-memory': { onPress: noop }, 'add-fact': { onPress: noop } }, tintColor: '#111111' })
    expect(main.map(i => (i.type === 'button' ? [i.identifier, i.accessibilityLabel, i.icon.name] : []))).toEqual([
      [`${DUO_VERTICAL_ITEM_PREFIX}search-memory`, 'Search memory', 'magnifyingglass'],
      [`${DUO_VERTICAL_ITEM_PREFIX}add-fact`, 'Add a fact', 'plus']
    ])
    const opened = buildDuoVerticalBarItems({
      screen: 'memory-fact',
      tintColor: '#111111',
      actions: { 'pause-fact': { label: 'Resume', sfSymbol: 'play', onPress: noop }, 'forget-fact': { label: 'Forget', tintColor: '#c0392b', onPress: noop } }
    })
    expect(opened.map(i => (i.type === 'button' ? [i.accessibilityLabel, i.icon.name, i.tintColor] : []))).toEqual([
      ['Resume', 'play', '#111111'],
      ['Forget', 'trash', '#c0392b']
    ])
  })

  test('the screen uses the web calls, the shared wording and the shared keyboard helper', () => {
    const actions = read('ios/src/memory/use-memory-actions.ts')
    for (const call of [
      "'memory.pause', { factId: fact.id, paused: !fact.paused }",
      "'memory.forget'",
      "'memory.restore'",
      "'memory.connect'",
      "kind: 'profile', scope: fact.shared ? 'shared' : 'bot'"
    ]) {
      expect(actions).toContain(call)
    }
    expect(actions).toContain('if (busyRef.current) return false')
    const list = read('ios/src/memory/use-memory-list.ts')
    expect(list).toContain("'memory.listAll'")
    expect(list).toContain('onMemoryChanged')
    expect(list).toContain('loadingMore.current) return')
    const form = read('ios/src/memory/memory-add-form.tsx')
    for (const part of ['useRevealAboveKeyboard', '<KeyboardBar', "label: 'Cancel'", "label: 'Save'", "supportedOrientations={['portrait', 'landscape']}"])
      expect(form).toContain(part)
    expect(read('ios/src/memory/memory-fact.tsx')).toContain("supportedOrientations={['portrait', 'landscape']}")
    for (const file of ['memory-main.tsx', 'memory-sub-pages.tsx', 'memory-rows.tsx', 'memory-fact.tsx']) {
      expect(read(`ios/src/memory/${file}`)).toContain('shared/client/memory/memory-lines')
    }
  })
})
