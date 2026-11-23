import { expect, test } from 'bun:test'
import { canArrange, canDelete, isUnread, primaryCandidates } from '../../web/src/bots/bot-menu-rules'
import { deleteSummary, filesHint, memoriesHint } from '../../web/src/bots/delete-copy'
import { testBot as bot } from './test-bot'

test('the primary bot cannot be arranged or deleted; non-primary bots can be deleted regardless of engine isDefault', () => {
  const primary = bot('main', { isPrimary: true })
  const builtIn = bot('default', { isDefault: true })
  const plain = bot('plain')
  expect([canArrange(primary), canDelete(primary)]).toEqual([false, false])
  expect([canArrange(builtIn), canDelete(builtIn)]).toEqual([true, true])
  expect([canArrange(plain), canDelete(plain)]).toEqual([true, true])
})

test('the primary mark can move to any other bot, hidden ones included', () => {
  const bots = [bot('main', { isPrimary: true }), bot('a'), bot('hidden', { prefs: { hidden: true } })]
  expect(primaryCandidates(bots).map(candidate => candidate.id)).toEqual(['a', 'hidden'])
})

test('a bot without activity reads as read', () => {
  expect(isUnread(bot('quiet'))).toBe(false)
  expect(isUnread(bot('new', { activity: { unread: true } }))).toBe(true)
})

test('the delete summary names the routines that go with the bot', () => {
  const stays = 'Anything it shared with your other bots stays.'
  expect(deleteSummary(null)).toBe(`Its conversation is removed. ${stays}`)
  expect(deleteSummary(0)).toBe(`Its conversation is removed. ${stays}`)
  expect(deleteSummary(1)).toBe(`Its conversation and its routine are removed. ${stays}`)
  expect(deleteSummary(2)).toBe(`Its conversation and its 2 routines are removed. ${stays}`)
})

test('the choice hints follow the choice, the place and the fact count', () => {
  expect(filesHint('archive', 'dialog')).toBe('Its folder moves to the archive')
  expect(filesHint('delete', 'settings')).toBe('Delete the folder for good')
  expect(memoriesHint('forget', 14)).toBe('14 facts are forgotten, restorable')
  expect(memoriesHint('keep', 1)).toBe('1 fact is kept')
  expect(memoriesHint('forget', 0)).toBe('It has no private memories')
  expect(memoriesHint('forget', null)).toBe('Forget them, restorable in Memory')
})
