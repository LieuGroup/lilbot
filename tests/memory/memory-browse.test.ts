import { describe, expect, test } from 'bun:test'
import { MemoryBrowseInput } from '../../shared/memory-schema'
import { methods } from '../../shared/protocol'
import { fakeService } from '../helpers/fake-engine'

const texts = (facts: { text: string }[]) => facts.map(fact => fact.text)

/** A server with two live bots, facts in every part of memory, and a deleted bot whose private facts were kept. */
function seeded() {
  const fake = fakeService()
  const { memory, store } = fake
  let now = Date.UTC(2026, 10, 1)
  const at = () => (now += 60_000)
  const write = (botId: string, scope: 'bot' | 'shared', text: string, kind: 'profile' | 'journal' = 'profile') => {
    const fact = memory.write({ botId, kind, scope, text, author: 'bot' })
    fake.database.query('UPDATE memory_facts SET learned_at = ? WHERE id = ?').run(at(), fact.id)
    return fact
  }
  write('b1', 'shared', 'Prefers short answers.')
  write('b1', 'bot', 'Release notes as a table.')
  write('b2', 'shared', 'Ask before spending money.')
  write('b2', 'bot', 'Shipped the paywall test.', 'journal')
  const gone = write('b1', 'shared', 'Posts at 5 pm.')
  memory.forgetAsUser(gone.id)
  write('old', 'bot', 'Kept from a deleted bot.')
  const [b1] = store.list()
  store.save({ ...b1, id: 'b2', name: 'Bot Two', engineBotId: 'b2-native', isDefault: false })
  store.save({ ...b1, id: 'old', name: 'Old Bot', engineBotId: 'old-native', isDefault: false })
  store.markDeleted(store.get('old'), { files: 'archive', privateMemories: 'keep' }, true)
  return fake
}

describe('memory.listAll', () => {
  test('lists every kept fact across bots, newest first, with counts and bot names', () => {
    const { service } = seeded()
    const page = service.browseMemory(MemoryBrowseInput.parse({ view: 'kept' }))
    expect(texts(page.facts)).toEqual([
      'Kept from a deleted bot.',
      'Shipped the paywall test.',
      'Ask before spending money.',
      'Release notes as a table.',
      'Prefers short answers.'
    ])
    expect(page).toMatchObject({ shared: 2, removed: 1, nextCursor: null })
    const old = page.bots.find(bot => bot.botId === 'old')
    expect(old).toEqual({ botId: 'old', name: 'Old Bot', deleted: true, facts: 1 })
    expect(page.bots.find(bot => bot.botId === 'b2')).toMatchObject({ deleted: false, facts: 1 })
  })

  test('narrows to shared facts, one bot’s own facts, or removed facts with who removed them', () => {
    const { service } = seeded()
    const browse = (input: object) => service.browseMemory(MemoryBrowseInput.parse(input)).facts
    expect(texts(browse({ view: 'shared' }))).toEqual(['Ask before spending money.', 'Prefers short answers.'])
    expect(texts(browse({ view: 'bot', botId: 'b1' }))).toEqual(['Release notes as a table.'])
    const [removed] = browse({ view: 'removed' })
    expect(removed).toMatchObject({ text: 'Posts at 5 pm.', forgottenBy: 'user' })
    expect(() => MemoryBrowseInput.parse({ view: 'bot' })).toThrow('Name the bot')
  })

  test('searches by words and pages without repeating or skipping a fact', () => {
    const { service } = seeded()
    expect(texts(service.browseMemory(MemoryBrowseInput.parse({ view: 'kept', query: 'table' })).facts)).toEqual(['Release notes as a table.'])
    const seen: string[] = []
    let cursor: string | undefined
    do {
      const page = service.browseMemory(MemoryBrowseInput.parse({ view: 'kept', limit: 2, cursor }))
      expect(page.facts.length).toBeLessThanOrEqual(2)
      seen.push(...texts(page.facts))
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    expect(seen).toHaveLength(5)
    expect(new Set(seen).size).toBe(5)
    expect(() => service.browseMemory(MemoryBrowseInput.parse({ view: 'kept', cursor: 'nope' }))).toThrow('no longer exists')
  })

  test('is a browser method only and caps a page at 200 facts', () => {
    expect('memory.listAll' in methods).toBe(true)
    expect(() => MemoryBrowseInput.parse({ view: 'kept', limit: 201 })).toThrow()
  })
})

test('the owner’s browser session answers memory.listAll and refuses bad params', async () => {
  const fake = seeded()
  const { BrowserSession } = await import('../../server/http/browser-session')
  const frames: any[] = []
  const session = new BrowserSession(fake.service, frame => frames.push(frame))
  await session.handle(JSON.stringify({ id: 1, method: 'memory.listAll', params: { view: 'shared' } }))
  await session.handle(JSON.stringify({ id: 2, method: 'memory.listAll', params: { view: 'bot' } }))
  expect(frames[0]).toMatchObject({ id: 1, ok: true, result: { shared: 2 } })
  expect(frames[1]).toMatchObject({ id: 2, ok: false, error: { code: 'invalid_params' } })
})
