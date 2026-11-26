/** #313: one `•••` per chat screen on every iPhone and iPhone Duo surface, opening one menu that holds New bot and
 *  Search bots above the bot's options, and scrolls with about half of the next row showing when too tall. */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReactElement } from 'react'
import { CHAT_MENU_APP_ACTIONS, menuAppActions, menuPeekHeight } from '../../ios/src/bots/chat-menu'
import { useBotMenuStore } from '../../ios/src/bots/menu-store'
import { rosterMenuActions } from '../../ios/src/bots/roster-state'
import type { SurfaceKind } from '../../ios/src/duo/layout'
import { buildDuoVerticalBarItems, DUO_VERTICAL_BAR_TABLE, DUO_VERTICAL_ITEM_PREFIX, resolveDuoStripScreen, shouldHideDuoChatHeader } from '../../ios/src/duo/vertical-bar'
import { BOT_MENU_LABELS } from '../../shared/client/bots/bot-menu-rules'
import { testBot } from '../web/test-bot'

const noop = () => {}
const avatar = { type: 'view', props: {}, key: null } as unknown as ReactElement
const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const allActions = {
  'bot-avatar': { element: avatar },
  'sidebar-toggle': { onPress: noop },
  'bot-menu': { onPress: noop },
  'search-bots': { onPress: noop }
}

/** Every chat surface: the Duo strip when iOS draws it, otherwise the horizontal header. */
const CHAT_SURFACES: { surface: SurfaceKind; chatFocused: boolean }[] = [
  { surface: 'phone', chatFocused: true },
  { surface: 'duo-folded', chatFocused: true },
  { surface: 'duo-unfolded-portrait', chatFocused: true },
  { surface: 'duo-unfolded-landscape', chatFocused: false }
]

describe('one ••• per chat screen (#313)', () => {
  test('the unfolded-landscape strip is avatar, sidebar toggle and one •••, so UIKit has nothing to overflow', () => {
    expect(DUO_VERTICAL_BAR_TABLE['unfolded-split'].map(slot => slot.id)).toEqual(['bot-avatar', 'sidebar-toggle', 'bot-menu'])
    expect(DUO_VERTICAL_BAR_TABLE['unfolded-split'].every(slot => slot.priority === 'high')).toBe(true)
    expect(DUO_VERTICAL_BAR_TABLE['folded-chat'].map(slot => slot.id)).toEqual(['bot-avatar', 'bot-menu'])
  })

  test('each chat surface shows exactly one ••• in the strip, or none there because the header carries it', () => {
    for (const input of CHAT_SURFACES) {
      const screen = resolveDuoStripScreen(input)
      const items = buildDuoVerticalBarItems({ screen, actions: allActions })
      const ellipses = items.filter(item => item.type === 'button' && item.icon.name === 'ellipsis')
      const stripCarriesChat = shouldHideDuoChatHeader({ surface: input.surface, verticalBarEdge: 'trailing', hasBot: true })
      expect({ surface: input.surface, ellipses: ellipses.length }).toEqual({ surface: input.surface, ellipses: stripCarriesChat ? 1 : 0 })
      if (stripCarriesChat) expect(ellipses[0]).toMatchObject({ identifier: `${DUO_VERTICAL_ITEM_PREFIX}bot-menu` })
    }
  })

  test('a chat ••• opens the menu with New bot and Search bots on top; the roster long-press menu does not', () => {
    useBotMenuStore.getState().openChatMenu('atlas')
    expect(useBotMenuStore.getState()).toMatchObject({ menuBotId: 'atlas', menuFromChat: true })
    expect(menuAppActions(useBotMenuStore.getState().menuFromChat).map(action => action.label)).toEqual(['New bot', 'Search bots'])
    useBotMenuStore.getState().openMenu('atlas')
    expect(useBotMenuStore.getState().menuFromChat).toBe(false)
    expect(menuAppActions(false)).toEqual([])
    useBotMenuStore.getState().closeBotOverlays()

    const options = rosterMenuActions(testBot('atlas'), true).map(action => action.label)
    expect(options.at(-1)).toBe(BOT_MENU_LABELS.delete)
    expect(rosterMenuActions(testBot('atlas'), true).at(-1)?.destructive).toBe(true)
    expect(CHAT_MENU_APP_ACTIONS.map(action => action.id)).toEqual(['new-bot', 'search-bots'])
  })

  test('every chat ••• (strip, compact header, split header) opens the chat menu, never the plain bot menu', () => {
    const shell = source('ios/src/duo/shell.tsx')
    const compactChat = source('ios/src/app/(tabs)/(bots)/chat.tsx')
    const chatScreen = source('ios/src/chat/screen.tsx')
    for (const file of [shell, compactChat, chatScreen]) {
      expect(file).toContain('openChatMenu(')
      expect(file).not.toMatch(/\bopenMenu\(/)
    }
    expect(shell).not.toContain("'new-bot'")
    const sheet = source('ios/src/bots/bot-menu-sheet.tsx')
    expect(sheet).toContain('openNewBot()')
    expect(sheet).toContain('requestRosterSearch()')
    expect(sheet).toContain('router.dismissAll()')
    expect(shell).toContain('useRosterSearchRequest(')
    expect(source('ios/src/duo/use-roster-search-request.ts')).toContain('clearRequest()')
  })

  test('Search bots from a chat screen opens roster search once the roster is on screen', () => {
    useBotMenuStore.getState().requestRosterSearch()
    expect(useBotMenuStore.getState().rosterSearchRequested).toBe(true)
    useBotMenuStore.getState().clearRosterSearchRequest()
    expect(useBotMenuStore.getState().rosterSearchRequested).toBe(false)
  })
})

describe('menu taller than the screen scrolls with half of the next row showing (#313)', () => {
  // Rows as drawn: app actions 52, header 56, seven options 48 each, Cancel 60.
  const heights = [52, 56, 48, 48, 48, 48, 48, 48, 48, 60]
  const rows = heights.map((height, index) => ({ y: heights.slice(0, index).reduce((sum, h) => sum + h, 0), height }))
  const total = heights.reduce((sum, h) => sum + h, 0)

  test('no scroll when every row fits', () => {
    expect(menuPeekHeight(rows, total)).toBeNull()
    expect(menuPeekHeight(rows, total + 100)).toBeNull()
    expect(menuPeekHeight([], 100)).toBeNull()
  })

  test('folded Duo landscape and iPhone landscape stop halfway through the next row, never a sliver', () => {
    for (const available of [442, 366, 300, 200]) {
      const peek = menuPeekHeight(rows, available)
      expect(peek).not.toBeNull()
      expect(peek as number).toBeLessThanOrEqual(available)
      const cut = rows.find(row => row.y < (peek as number) && row.y + row.height > (peek as number))
      expect(cut).toBeDefined()
      expect((peek as number) - (cut as { y: number }).y).toBe((cut as { height: number }).height / 2)
    }
  })
})
