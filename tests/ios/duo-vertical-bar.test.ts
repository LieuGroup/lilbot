/** Unit tests for iPhone Duo's single-table vertical side-strip configuration, availability guards,
 *  ordinary iPhone/iPad preservation, and overflow reachability invariants. */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildDuoVerticalBarItems,
  DUO_VERTICAL_BAR_TABLE,
  DUO_VERTICAL_ITEM_PREFIX,
  duoVerticalHeaderOptions,
  isDuoVerticalBarActive,
  resolveDuoStripScreen,
  shouldShowInlineSidebarToggle
} from '../../ios/src/duo/vertical-bar'

describe('iPhone Duo native vertical side-strip table and availability guards', () => {
  test('isDuoVerticalBarActive is strictly gated on iOS 27.1+ verticalBarEdge and Duo strip surfaces', () => {
    // Older iOS (< 27.1) always reports verticalBarEdge = null -> must stay inactive even on Duo dimensions.
    expect(isDuoVerticalBarActive({ surface: 'duo-folded', verticalBarEdge: null })).toBe(false)
    expect(isDuoVerticalBarActive({ surface: 'duo-unfolded-landscape', verticalBarEdge: null })).toBe(false)

    // Ordinary iPhones, iPads, and Duo Unfolded Portrait stay untouched even if an edge were passed.
    expect(isDuoVerticalBarActive({ surface: 'phone', verticalBarEdge: null })).toBe(false)
    expect(isDuoVerticalBarActive({ surface: 'phone', verticalBarEdge: 'trailing' })).toBe(false)
    expect(isDuoVerticalBarActive({ surface: 'pad', verticalBarEdge: null })).toBe(false)
    expect(isDuoVerticalBarActive({ surface: 'pad', verticalBarEdge: 'trailing' })).toBe(false)
    expect(isDuoVerticalBarActive({ surface: 'duo-unfolded-portrait', verticalBarEdge: 'trailing' })).toBe(false)

    // Active only on Folded Duo and Unfolded Landscape Duo when iOS 27.1+ reports a vertical bar edge.
    expect(isDuoVerticalBarActive({ surface: 'duo-folded', verticalBarEdge: 'trailing' })).toBe(true)
    expect(isDuoVerticalBarActive({ surface: 'duo-folded', verticalBarEdge: 'leading' })).toBe(true)
    expect(isDuoVerticalBarActive({ surface: 'duo-unfolded-landscape', verticalBarEdge: 'trailing' })).toBe(true)
    expect(isDuoVerticalBarActive({ surface: 'duo-unfolded-landscape', verticalBarEdge: 'leading' })).toBe(true)
  })

  test('shouldShowInlineSidebarToggle preserves exact iPad and pre-27.1 placement while clearing Duo content', () => {
    // iPad split (verticalBarActive = false) keeps the inline sidebar toggle in Chat header.
    expect(shouldShowInlineSidebarToggle({ showSidebarToggle: true, verticalBarActive: false })).toBe(true)
    // Duo unfolded split on iOS 27.1+ (verticalBarActive = true) moves it into the 84 pt strip.
    expect(shouldShowInlineSidebarToggle({ showSidebarToggle: true, verticalBarActive: true })).toBe(false)
    // Compact screens never show the sidebar toggle.
    expect(shouldShowInlineSidebarToggle({ showSidebarToggle: false, verticalBarActive: false })).toBe(false)
    expect(shouldShowInlineSidebarToggle({ showSidebarToggle: false, verticalBarActive: true })).toBe(false)
  })

  test('resolveDuoStripScreen maps every surface and chat focus cleanly', () => {
    expect(resolveDuoStripScreen({ surface: 'phone', chatFocused: false })).toBeNull()
    expect(resolveDuoStripScreen({ surface: 'pad', chatFocused: false })).toBeNull()
    expect(resolveDuoStripScreen({ surface: 'duo-folded', chatFocused: false })).toBe('folded-roster')
    expect(resolveDuoStripScreen({ surface: 'duo-folded', chatFocused: true })).toBe('folded-chat')
    expect(resolveDuoStripScreen({ surface: 'duo-unfolded-landscape', chatFocused: false })).toBe('unfolded-split')
    expect(resolveDuoStripScreen({ surface: 'duo-unfolded-portrait', chatFocused: true })).toBe('unfolded-portrait')
  })

  test('DUO_VERTICAL_BAR_TABLE keeps order, priorities, and visible overflow labels in one table', () => {
    expect(DUO_VERTICAL_BAR_TABLE['folded-roster'].map(s => s.id)).toEqual(['search-bots'])
    expect(DUO_VERTICAL_BAR_TABLE['folded-chat'].map(s => s.id)).toEqual(['bot-menu'])
    expect(DUO_VERTICAL_BAR_TABLE['unfolded-split'].map(s => s.id)).toEqual(['sidebar-toggle', 'bot-menu', 'new-bot', 'search-bots'])
    expect(DUO_VERTICAL_BAR_TABLE['unfolded-portrait']).toEqual([])

    // Overflow reachability invariant: every item has a non-empty visible label + SF symbol so UIKit's
    // overflow menu renders it visibly (never gesture-only), and high-priority controls stay above low-priority ones.
    for (const slots of Object.values(DUO_VERTICAL_BAR_TABLE)) {
      for (const slot of slots) {
        expect(slot.defaultLabel.trim().length).toBeGreaterThan(0)
        expect(slot.sfSymbol.trim().length).toBeGreaterThan(0)
        expect(['high', 'standard', 'low']).toContain(slot.priority)
      }
    }
    const splitPriorities = Object.fromEntries(DUO_VERTICAL_BAR_TABLE['unfolded-split'].map(s => [s.id, s.priority]))
    expect(splitPriorities['sidebar-toggle']).toBe('high')
    expect(splitPriorities['bot-menu']).toBe('high')
    expect(splitPriorities['new-bot']).toBe('standard')
    expect(splitPriorities['search-bots']).toBe('low')
  })

  test('buildDuoVerticalBarItems preserves table order, prefixes identifiers, and omits unregistered handlers', () => {
    const noop = () => {}
    const splitPartial = buildDuoVerticalBarItems({
      screen: 'unfolded-split',
      actions: {
        'search-bots': { onPress: noop },
        'sidebar-toggle': { label: 'Hide bots sidebar', onPress: noop }
      },
      tintColor: '#111111'
    })
    // Follows DUO_VERTICAL_BAR_TABLE order (sidebar-toggle before search-bots), regardless of input object key order.
    expect(splitPartial.map(item => item.identifier)).toEqual([`${DUO_VERTICAL_ITEM_PREFIX}sidebar-toggle`, `${DUO_VERTICAL_ITEM_PREFIX}search-bots`])
    expect(splitPartial[0]).toMatchObject({
      type: 'button',
      label: 'Hide bots sidebar',
      accessibilityLabel: 'Hide bots sidebar',
      icon: { type: 'sfSymbol', name: 'sidebar.left' },
      visibilityPriority: 'high',
      tintColor: '#111111'
    })
    expect(splitPartial[1]).toMatchObject({
      type: 'button',
      label: 'Search bots',
      accessibilityLabel: 'Search bots',
      icon: { type: 'sfSymbol', name: 'magnifyingglass' },
      visibilityPriority: 'low'
    })

    // Blank custom label falls back to table defaultLabel so UIKit overflow menu never renders an empty row.
    const fallbackLabel = buildDuoVerticalBarItems({
      screen: 'folded-chat',
      actions: { 'bot-menu': { label: '   ', onPress: noop } }
    })
    expect(fallbackLabel[0]?.label).toBe('Bot options')
    expect(buildDuoVerticalBarItems({ screen: null, actions: { 'sidebar-toggle': { onPress: noop } } })).toEqual([])
    expect(buildDuoVerticalBarItems({ screen: 'unfolded-portrait', actions: { 'sidebar-toggle': { onPress: noop } } })).toEqual([])
  })

  test('duoVerticalHeaderOptions hides header when inactive and exposes transparent zero-title items when active', () => {
    expect(duoVerticalHeaderOptions([], '#111111')).toEqual({ headerShown: false, unstable_headerRightItems: undefined })
    const items = buildDuoVerticalBarItems({ screen: 'unfolded-split', actions: { 'sidebar-toggle': { onPress: () => {} } } })
    const active = duoVerticalHeaderOptions(items, '#111111')
    expect(active.headerShown).toBe(true)
    expect(active.title).toBe('')
    expect(active.headerTransparent).toBe(true)
    expect(active.headerShadowVisible).toBe(false)
    expect(active.headerBackVisible).toBe(false)
    expect(active.unstable_headerRightItems?.()).toEqual(items)
  })

  test('DuoShell wires useVerticalBarEdge and duoVerticalHeaderOptions cleanly', () => {
    const shellSource = readFileSync(resolve(process.cwd(), 'ios/src/duo/shell.tsx'), 'utf8')
    const surfaceSource = readFileSync(resolve(process.cwd(), 'ios/src/duo/use-surface.ts'), 'utf8')
    expect(surfaceSource).toContain("import { useVerticalBarEdgeIOS } from 'expo-status-bar'")
    expect(shellSource).toContain('useVerticalBarEdge()')
    expect(shellSource).toContain('isDuoVerticalBarActive({ surface, verticalBarEdge })')
    expect(shellSource).toContain('shouldShowInlineSidebarToggle(')
    expect(shellSource).toContain('duoVerticalHeaderOptions(verticalBarItems, theme.foreground)')
  })
})
