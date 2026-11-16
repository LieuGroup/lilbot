import { expect, test } from 'bun:test'
import { defaultAvatar } from '../../shared/avatar'
import type { Bot } from '../../shared/bot-schema'
import { primaryBot, rosterBots } from '../../web/src/bots/primary-bot'

const bot = (id: string, isPrimary = false): Bot => ({
  id,
  name: id,
  function: '',
  model: null,
  isDefault: false,
  isPrimary,
  workspace: '',
  prefs: { avatar: defaultAvatar(id), sectionId: null, pinned: false, hidden: false }
})

test('startup selects the primary and the roster puts it first without mutating the list', () => {
  const bots = [bot('a'), bot('b', true), bot('c')]
  expect(primaryBot(bots)?.id).toBe('b')
  expect(rosterBots(bots).map(bot => bot.id)).toEqual(['b', 'a', 'c'])
  expect(bots.map(bot => bot.id)).toEqual(['a', 'b', 'c'])
  expect(primaryBot([])).toBeUndefined()
})
