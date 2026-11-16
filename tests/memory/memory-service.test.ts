import { describe, expect, test } from 'bun:test'

import { openDatabase } from '../../server/database/database'
import { MemoryService, shortId } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'

/** A service on an empty database with a clock the test moves forward one day per write. */
function memory() {
  let now = Date.UTC(2026, 10, 1)
  const service = new MemoryService(new MemoryStore(openDatabase(':memory:')), () => now)
  return { service, nextDay: () => (now += 86_400_000) }
}

const texts = (facts: { text: string }[]) => facts.map(fact => fact.text)

describe('who sees what', () => {
  test('facts about the user are shared by default; a bot’s history stays with the bot', () => {
    const { service } = memory()
    expect(service.write({ botId: 'footy', kind: 'profile', text: 'Post at 5 pm Adelaide time.', author: 'bot' }).scope).toBe('shared')
    expect(service.write({ botId: 'footy', kind: 'journal', text: 'Built the Tassie slideshow.', author: 'bot' }).scope).toBe('bot')
    expect(texts(service.list('researcher'))).toEqual(['Post at 5 pm Adelaide time.'])
    expect(texts(service.list('footy'))).toEqual(['Built the Tassie slideshow.', 'Post at 5 pm Adelaide time.'])
  })

  test('a bot can keep a lasting fact private, or share a journal entry', () => {
    const { service } = memory()
    service.write({ botId: 'footy', kind: 'profile', scope: 'bot', text: 'I draft captions in three variants.', author: 'bot' })
    service.write({ botId: 'footy', kind: 'journal', scope: 'shared', text: 'Released version 1.1.2.', author: 'bot' })
    expect(texts(service.list('researcher'))).toEqual(['Released version 1.1.2.'])
  })
})

describe('writing', () => {
  test('saving the same fact again does not create a duplicate', () => {
    const { service } = memory()
    const first = service.write({ botId: 'b', kind: 'profile', text: 'Prefers short replies.', author: 'bot' })
    const again = service.write({ botId: 'b', kind: 'profile', text: '  prefers short replies.  ', author: 'bot' })
    expect(again.id).toBe(first.id)
    expect(service.list('b')).toHaveLength(1)
  })

  test('empty and oversized facts are refused with a message the bot can act on', () => {
    const { service } = memory()
    expect(() => service.write({ botId: 'b', kind: 'profile', text: '   ', author: 'bot' })).toThrow('Write the fact to remember.')
    expect(() => service.write({ botId: 'b', kind: 'profile', text: 'x'.repeat(501), author: 'bot' })).toThrow('Keep a fact under 500 characters.')
  })
})

describe('forgetting', () => {
  test('a bot forgets by short id; the fact leaves memory but a correction can be written', () => {
    const { service } = memory()
    const old = service.write({ botId: 'b', kind: 'profile', text: 'Post at 5 pm.', author: 'bot' })
    expect(service.forgetAsBot('b', shortId(old)).id).toBe(old.id)
    service.write({ botId: 'b', kind: 'profile', text: 'Post at 6 pm.', author: 'bot' })
    expect(texts(service.list('b'))).toEqual(['Post at 6 pm.'])
  })

  test('a bot cannot forget another bot’s private fact, but can correct a shared one', () => {
    const { service } = memory()
    const secret = service.write({ botId: 'a', kind: 'journal', text: 'Private note.', author: 'bot' })
    const shared = service.write({ botId: 'a', kind: 'profile', text: 'Lives in Adelaide.', author: 'bot' })
    expect(() => service.forgetAsBot('b', secret.id)).toThrow('No remembered fact has that id.')
    service.forgetAsBot('b', shared.id)
    expect(texts(service.list('a'))).toEqual(['Private note.'])
  })

  test('the user can forget any fact; an unknown or already forgotten one is reported', () => {
    const { service } = memory()
    const fact = service.write({ botId: 'a', kind: 'journal', text: 'Private note.', author: 'bot' })
    service.forgetAsUser(fact.id)
    expect(service.list('a')).toEqual([])
    expect(() => service.forgetAsUser(fact.id)).toThrow('That fact is not in memory.')
    expect(() => service.forgetAsBot('a', 'zzzz')).toThrow('No remembered fact has that id.')
  })
})

describe('recall', () => {
  test('finds facts by any word, only among what the bot can see, and can narrow by kind', () => {
    const { service } = memory()
    service.write({ botId: 'a', kind: 'profile', text: 'TikTok posts go out at 5 pm.', author: 'bot' })
    service.write({ botId: 'a', kind: 'journal', text: 'Checked TikTok views: 8,686.', author: 'bot' })
    service.write({ botId: 'b', kind: 'journal', text: 'TikTok captcha blocked the login.', author: 'bot' })
    expect(texts(service.recall('a', 'tiktok')).sort()).toEqual(['Checked TikTok views: 8,686.', 'TikTok posts go out at 5 pm.'])
    expect(texts(service.recall('a', 'tiktok', { kind: 'journal' }))).toEqual(['Checked TikTok views: 8,686.'])
    expect(service.recall('a', 'nothing-like-this')).toEqual([])
  })

  test('forgotten facts are not recalled, and odd queries are safe', () => {
    const { service } = memory()
    const fact = service.write({ botId: 'a', kind: 'profile', text: 'Uses the "fast" tier.', author: 'bot' })
    expect(texts(service.recall('a', '"fast" AND (tier) *'))).toEqual(['Uses the "fast" tier.'])
    expect(texts(service.recall('a', '!!!'))).toEqual(['Uses the "fast" tier.'])
    service.forgetAsUser(fact.id)
    expect(service.recall('a', 'fast')).toEqual([])
  })

  test('the limit is clamped', () => {
    const { service } = memory()
    for (let i = 0; i < 60; i++) service.write({ botId: 'a', kind: 'journal', text: `Entry number ${i}`, author: 'bot' })
    expect(service.recall('a', 'entry', { limit: 500 })).toHaveLength(50)
    expect(service.recall('a', 'entry', { limit: 0 })).toHaveLength(1)
  })
})

describe('the block a bot sees before each turn', () => {
  test('lists lasting facts with ids, dates and who shared them, then recent history in order', () => {
    const { service, nextDay } = memory()
    const own = service.write({ botId: 'footy', kind: 'profile', scope: 'bot', text: 'Three caption variants.', author: 'bot' })
    nextDay()
    service.write({ botId: 'lil', kind: 'profile', text: 'Oscar lives in Adelaide.', author: 'bot' })
    nextDay()
    service.write({ botId: 'footy', kind: 'journal', text: 'Built the slideshow.', author: 'bot' })
    nextDay()
    service.write({ botId: 'footy', kind: 'journal', text: 'Posted it.', author: 'bot' })

    const block = service.contextBlock('footy')
    expect(block).toMatchObject({ shown: 4, total: 4 })
    expect(block.text).toContain(`[${shortId(own)}] Three caption variants.`)
    expect(block.text.replace(/\[[0-9a-f]{8}\]/g, '[id]')).toBe(
      [
        'Lasting facts:',
        '- [id] Oscar lives in Adelaide. (2026-11-02, from lil)',
        '- [id] Three caption variants. (2026-11-01)',
        'Recent history:',
        '- [id] 2026-11-03: Built the slideshow.',
        '- [id] 2026-11-04: Posted it.'
      ].join('\n')
    )
  })

  test('is empty for a bot with no memory', () => {
    expect(memory().service.contextBlock('new')).toEqual({ text: '', shown: 0, total: 0 })
  })

  test('stays within its budget and says how much is left out', () => {
    const { service } = memory()
    for (let i = 0; i < 40; i++) service.write({ botId: 'a', kind: 'profile', text: `Fact ${i} ${'x'.repeat(400)}`, author: 'bot' })
    for (let i = 0; i < 30; i++) service.write({ botId: 'a', kind: 'journal', text: `Entry ${i}`, author: 'bot' })
    const block = service.contextBlock('a')
    expect(block.text.length).toBeLessThan(6500)
    expect(block.total).toBe(70)
    expect(block.shown).toBeLessThan(25)
    expect(block.text).toContain(`${70 - block.shown} older facts are not shown`)
    expect(block.text).toContain('Entry 29')
    expect(block.text).not.toContain('Entry 5\n')
  })
})

test('deleting a bot drops its private facts and keeps what it shared', () => {
  const { service } = memory()
  service.write({ botId: 'gone', kind: 'journal', text: 'Private history.', author: 'bot' })
  service.write({ botId: 'gone', kind: 'profile', text: 'Oscar prefers tables.', author: 'bot' })
  service.forgetBot('gone')
  expect(texts(service.list('other'))).toEqual(['Oscar prefers tables.'])
  expect(texts(service.list('gone'))).toEqual(['Oscar prefers tables.'])
})
