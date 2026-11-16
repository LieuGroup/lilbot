import { expect, test } from 'bun:test'
import { primaryBot } from '../../web/src/bots/primary-bot'
import { rosterGroups } from '../../web/src/bots/roster-groups'
import { testBot as bot } from './test-bot'

test('startup selects the primary and the roster puts it first without mutating the list', () => {
  const bots = [bot('a'), bot('b', { isPrimary: true }), bot('c')]
  expect(primaryBot(bots)?.id).toBe('b')
  const groups = rosterGroups(bots, [])
  expect(groups.top.map(bot => bot.id)).toEqual(['b'])
  expect(groups.unassigned.map(bot => bot.id)).toEqual(['a', 'c'])
  expect(bots.map(bot => bot.id)).toEqual(['a', 'b', 'c'])
  expect(primaryBot([])).toBeUndefined()
})
