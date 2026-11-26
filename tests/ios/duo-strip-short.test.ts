/** Folded Duo in landscape: the strip has no room for the avatar, so exactly one ••• carries "Bot details" first. */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReactElement } from 'react'
import { useBotMenuStore } from '../../ios/src/bots/menu-store'
import { classifySurface } from '../../ios/src/duo/layout'
import { buildDuoVerticalBarItems, DUO_VERTICAL_ITEM_PREFIX, resolveDuoStripScreen } from '../../ios/src/duo/vertical-bar'

const avatar = { type: 'view', props: {}, key: null } as unknown as ReactElement
const noop = () => {}
const chatStrip = (width: number, height: number) => {
  const surface = classifySurface({ width, height })
  const screen = resolveDuoStripScreen({ surface, chatFocused: true, windowHeight: height })
  return { screen, items: buildDuoVerticalBarItems({ screen, actions: { 'bot-avatar': { element: avatar }, 'bot-menu': { label: 'More for Atlas', onPress: noop } } }) }
}

describe('folded Duo strip in a short window', () => {
  test('folded landscape (both rotations, any text size: the window is 678x466 either way) shows one ••• and no avatar', () => {
    const { screen, items } = chatStrip(678, 466)
    expect(screen).toBe('folded-chat-short')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ type: 'button', identifier: `${DUO_VERTICAL_ITEM_PREFIX}bot-menu`, icon: { name: 'ellipsis' }, visibilityPriority: 'high' })
    expect(items.filter(item => item.type === 'custom')).toHaveLength(0)
  })

  test('folded portrait and unfolded landscape keep the avatar and the one •••', () => {
    for (const [w, h] of [
      [466, 678],
      [951, 669]
    ]) {
      const { items } = chatStrip(w, h)
      expect(items[0]?.type).toBe('custom')
      expect(items.filter(item => item.type === 'button' && item.identifier.endsWith('bot-menu'))).toHaveLength(1)
    }
    expect(resolveDuoStripScreen({ surface: 'duo-folded', chatFocused: false, windowHeight: 466 })).toBe('folded-roster')
  })

  test('the ••• menu lists Bot details first only when the strip dropped the avatar', () => {
    const store = useBotMenuStore.getState()
    store.openMenu('bot-a', { withDetails: true })
    expect(useBotMenuStore.getState()).toMatchObject({ menuBotId: 'bot-a', menuWithDetails: true })
    store.closeMenu()
    expect(useBotMenuStore.getState().menuWithDetails).toBe(false)
    store.openMenu('bot-a')
    expect(useBotMenuStore.getState().menuWithDetails).toBe(false)
    store.closeMenu()

    const sheet = readFileSync(resolve(process.cwd(), 'ios/src/bots/bot-menu-sheet.tsx'), 'utf8')
    expect(sheet).toContain("[...(menuWithDetails ? [{ id: 'details' as const, label: 'Bot details' }] : []), ...rosterMenuActions(")
    expect(sheet).toContain("router.push({ pathname: '/(tabs)/(bots)/bot-details', params: { botId: detailsBotId } })")
    const chat = readFileSync(resolve(process.cwd(), 'ios/src/app/(tabs)/(bots)/chat.tsx'), 'utf8')
    expect(chat).toContain('resolveDuoStripScreen({ surface, chatFocused: true, windowHeight: metrics.height })')
    expect(chat).toContain("openMenu(bot.id, { withDetails: stripScreen === 'folded-chat-short' })")
  })
})
