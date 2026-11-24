import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildRosterListItems, closeRosterSearch, INITIAL_ROSTER_SEARCH_STATE, openRosterSearch, setRosterSearchQuery, toggleRosterSearch } from '../../ios/src/bots/roster-list'
import { testBot as bot } from '../web/test-bot'

describe('iOS Roster search state wiring, section collapse, and 44 pt controls', () => {
  test('pure search transitions open cleanly, track query while open, and close+clear on toggle or close', () => {
    expect(openRosterSearch(INITIAL_ROSTER_SEARCH_STATE)).toEqual({ open: true, query: '' })
    expect(openRosterSearch({ open: true, query: 'chief' })).toEqual({ open: true, query: 'chief' })
    expect(setRosterSearchQuery({ open: true, query: '' }, 'chief')).toEqual({ open: true, query: 'chief' })
    expect(setRosterSearchQuery(INITIAL_ROSTER_SEARCH_STATE, 'chief')).toEqual(INITIAL_ROSTER_SEARCH_STATE)
    expect(toggleRosterSearch({ open: false, query: '' })).toEqual({ open: true, query: '' })
    expect(toggleRosterSearch({ open: true, query: 'chief' })).toEqual({ open: false, query: '' })
    expect(closeRosterSearch()).toEqual({ open: false, query: '' })
  })

  test('DuoShell, Roster, RosterSearchBar, and ModelPill wire the real close paths and >= 44 pt hit targets', () => {
    const shellSource = readFileSync(resolve(process.cwd(), 'ios/src/duo/shell.tsx'), 'utf8')
    const rosterSource = readFileSync(resolve(process.cwd(), 'ios/src/bots/roster.tsx'), 'utf8')
    const chromeSource = readFileSync(resolve(process.cwd(), 'ios/src/bots/roster-chrome.tsx'), 'utf8')
    const modelPillSource = readFileSync(resolve(process.cwd(), 'ios/src/bots/model-pill.tsx'), 'utf8')

    expect(shellSource).toContain('setSearch(openRosterSearch)')
    expect(shellSource).toContain('setSearch(closeRosterSearch)')
    expect(shellSource).toContain('setSearch(toggleRosterSearch)')
    expect(shellSource).toContain('setRosterSearchQuery(prev, query)')
    expect(shellSource).toContain("'search-bots': { onPress: toggleSearch }")
    expect(shellSource).toContain('if (!isFocused || !showRoster) closeSearch()')
    expect(shellSource).toContain('if (prevSearchOpenRef.current && !search.open) Keyboard.dismiss()')
    expect(shellSource).not.toMatch(/setSearch\([^)]*Keyboard\.dismiss/)

    expect(rosterSource).toContain('onChange={onChangeSearchQuery} onClose={onCloseSearch}')
    expect(rosterSource).not.toContain('usePullToSearch')

    expect(chromeSource).toContain('const SECTION_SLOP = { top: 12, bottom: 12, left: 6, right: 12 } as const')
    expect(chromeSource).toMatch(/testID="roster-search-close"[\s\S]{0,80}onPress=\{handleClose\}/)
    expect(chromeSource).toContain('width: 44, height: 44')

    expect(modelPillSource).toContain('hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}')
    expect(modelPillSource).toContain('maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.modelPill}')
  })

  test('collapsible user sections hide bots unless collapsed section contains the selected bot', () => {
    const bots = [bot('a', { prefs: { sectionId: 's1' } }), bot('b', { prefs: { sectionId: 's2' } })]
    const sections = [
      { id: 's1', name: 'Product' },
      { id: 's2', name: 'Engineering' }
    ]
    const collapsed = buildRosterListItems({
      bots,
      sections,
      loaded: true,
      connected: true,
      error: '',
      query: '',
      selectedId: 'b',
      unassignedOpen: false,
      hiddenOpen: false,
      collapsedSections: { s1: true, s2: true }
    })
    expect(collapsed.filter(i => i.kind === 'bot').map(i => i.bot.id)).toEqual(['b'])
  })
})
