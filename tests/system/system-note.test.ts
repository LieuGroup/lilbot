import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BotPrefsStore } from '../../server/bots/bot-prefs-store'
import { BotService } from '../../server/bots/bot-service'
import { BotStore } from '../../server/bots/bot-store'
import { buildNote, type NoteFacts, withNote, withoutNote } from '../../server/bots/system-note'
import { Workspaces } from '../../server/bots/workspaces'
import { openDatabase } from '../../server/database/database'
import type { BotEngine } from '../../server/engines/bot-engine'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import { toolsVersion } from '../../server/system/system-connection'
import { codingState } from '../../server/system/system-note-facts'
import { detail, fakeEngine } from '../helpers/fake-engine'
import { systemFixture } from './system-fixture'

const words = (text: string) => text.split(/\s+/).filter(Boolean).length
const facts = (others: NoteFacts['others'] = [{ name: 'Writer', function: 'Drafts posts' }]): NoteFacts => ({
  bot: { id: 'b1', name: 'Bot One', workspace: '/home/oscar/lilbot/workspaces/b1', model: { provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-5-5' } },
  others,
  computers: ['leader-box', 'MacBook'],
  coding: 'available, signed in until 2026-12-01',
  release: 'abcdef012345'
})

test('the note states who the bot is, where it runs and points at the two tools, in about 250 words', () => {
  const note = buildNote(facts())
  for (const part of [
    '"Bot One"',
    'id b1',
    '/home/oscar/lilbot/workspaces/b1',
    'cliproxyapi/anthropic/claude-sonnet-5-5',
    'leader machine',
    'Writer (Drafts posts)',
    'leader-box, MacBook',
    'abcdef012345',
    '[LilBot origin]',
    'lilbot_guide topic `computers`',
    'never guess for a command that changes something',
    'ask Oscar in your reply',
    'lilbot_about',
    'lilbot_guide',
    'bun run deploy',
    'before any work beyond a reply, however small',
    'open an item with lilbot_work. Not for answering a question',
    '"done" definition before starting'
  ]) {
    expect(note).toContain(part)
  }
  expect(words(note)).toBeGreaterThan(90)
  expect(words(note)).toBeLessThan(260)
  expect(buildNote({ ...facts([]), bot: { ...facts().bot, model: null } })).toContain("the engine's default")
})

test('a long roster stays short: a few bots are named and the rest counted', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ name: `Bot number ${i}`, function: 'x'.repeat(300) }))
  const note = buildNote(facts(many))
  expect(note).toContain('and 32 more')
  expect(words(note)).toBeLessThan(310)
  expect(note).not.toContain('x'.repeat(60))
})

test('the note sits after the user’s instructions and comes off again, leaving the user’s text as written', () => {
  const note = buildNote(facts())
  const instructions = 'Be brief.\n\nAnswer in plain text.'
  const applied = withNote(instructions, note)
  expect(applied.startsWith(`${instructions}\n\n`)).toBe(true)
  expect(withoutNote(applied)).toBe(instructions)
  expect(withNote('  ', note)).toBe(note)
  expect(withoutNote(withNote(withNote(instructions, note), note))).toBe(instructions)
})

test('engines run the instructions with the note; LilBot’s stored and shown instructions never include it', async () => {
  const fake = fakeEngine()
  const applied: string[] = []
  const engine: BotEngine = {
    ...fake.engine,
    applyIdentity: async (id, identity) => {
      applied.push(identity.instructions)
      return fake.engine.applyIdentity(id, identity)
    }
  }
  const database = openDatabase(':memory:')
  const store = new BotStore(database)
  const service = new BotService(engine, store, new BotPrefsStore(database), new Workspaces('/tmp/lilbot-note-test'), new MemoryService(new MemoryStore(database)), {
    systemNote: bot => `NOTE for ${bot.name}`
  })
  const bot = await service.createBot({ name: 'Writer', function: '', instructions: 'Be kind.' })
  expect(applied.at(-1)).toBe('Be kind.\n\nNOTE for Writer')
  expect(store.get(bot.id).instructions).toBe('Be kind.')
  expect((await service.getBot(bot.id)).instructions).toBe('Be kind.')
  await service.updateBot({ botId: bot.id, name: 'Author', instructions: 'Be bold.' })
  expect(applied.at(-1)).toBe('Be bold.\n\nNOTE for Author')
})

test('importing an engine’s bots takes the note off instructions an earlier LilBot wrote there', async () => {
  const fake = fakeEngine()
  const engine: BotEngine = { ...fake.engine, importBots: async () => [{ ...detail, instructions: withNote('Be kind.', buildNote(facts())) }] }
  const database = openDatabase(':memory:')
  const store = new BotStore(database)
  await new BotService(engine, store, new BotPrefsStore(database), new Workspaces('/tmp/lilbot-note-test'), new MemoryService(new MemoryStore(database))).listBots()
  expect(store.get('b1').instructions).toBe('Be kind.')
})

test('coding state reads as one line for each sign-in state', () => {
  expect(codingState({ state: 'connected', expiresAt: 1700000000000 })).toBe('available, signed in until 2023-11-14')
  expect(codingState({ state: 'missing' })).toContain('not signed in')
  expect(codingState({ state: 'revoked' })).toContain('revoked')
  expect(codingState({ state: 'expired', expiresAt: 1700000000000 })).toContain('expired on 2023-11-14')
})

test('the connection is the same on every start, so unchanged restarts skip the engine’s work; a changed tool changes it', () => {
  const a = systemFixture()
  const b = systemFixture()
  expect(a.connection('b1')).toEqual(b.connection('b1'))
  expect(a.connection('b1')).toMatchObject({ name: 'lilbot_system', timeoutSeconds: 300 })
  expect(a.connection('b1').url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/engine\/lilbot\/mcp\?tools=[0-9a-f]{12}$/)
  expect(a.connection('b1').tools).toContain('lilbot_about')
  expect(a.connection('b1').bearerToken).not.toBe(a.connection('b2').bearerToken)
  expect(a.connection('b1').bearerToken).not.toContain('engine-token')
  const changed = a.tools.map((tool, i) => (i ? tool : { ...tool, description: `${tool.description} Changed.` }))
  expect(toolsVersion(changed)).not.toBe(toolsVersion(a.tools))
})

test('the guide ships with the code, every topic is listed, and the tools it names exist', async () => {
  const f = systemFixture()
  const folder = join(import.meta.dir, '../../server/system/guide')
  const files = readdirSync(folder).filter(file => file.endsWith('.md'))
  const listed = (await f.call('b1', 'lilbot_guide')).data.topics as string[]
  expect(listed).toHaveLength(files.length)
  // Names a guide may use: this server's tools and the two connections' names.
  const names = new Set([...f.tools.map(tool => tool.name), 'lilbot_t3', 'lilbot_system'])
  for (const file of files) {
    const topic = file.slice(0, -3)
    const text = readFileSync(join(folder, file), 'utf8')
    expect((await f.call('b1', 'lilbot_guide', { topic })).data.guide).toBe(text)
    expect(words(text)).toBeLessThan(260)
    for (const name of text.match(/lilbot_[a-z0-9_]+/g) ?? []) expect(names.has(name)).toBe(true)
  }
  expect((await f.call('b1', 'lilbot_guide', { topic: '../../etc/passwd' })).error).toContain('Invalid arguments')
  for (const name of buildNote(facts()).match(/lilbot_[a-z0-9_]+/g) ?? []) expect(names.has(name)).toBe(true)
  for (const rule of ['T3 Code', 'bun run deploy', 'live bot']) expect((await f.call('b1', 'lilbot_guide', { topic: 'changing-lilbot' })).data.guide).toContain(rule)
})
