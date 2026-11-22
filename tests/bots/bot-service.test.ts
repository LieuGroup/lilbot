import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { defaultAvatar } from '../../shared/avatar'
import { fakeService } from '../helpers/fake-engine'

const ignore = () => {}

describe('a bot is the app identity plus the user’s preferences plus its workspace', () => {
  test('listing merges all three', async () => {
    const { service, root } = fakeService()
    expect(await service.listBots()).toEqual([
      {
        id: 'b1',
        name: 'Bot One',
        function: '',
        model: null,
        reasoningEffort: null,
        permissionMode: 'full-access',
        isDefault: false,
        isPrimary: false,
        runnable: false,
        runtimePending: true,
        prefs: { avatar: defaultAvatar('b1'), sectionId: null, pinned: false, pinnedAt: null, hidden: false },
        workspace: join(root, 'b1')
      }
    ])
  })

  test('preferences change only LilBot’s data and tell clients to refresh', async () => {
    const { service, log, changes } = fakeService()
    const section = service.createSection('Product')
    const updated = await service.setPrefs({ botId: 'b1', pinned: true, sectionId: section.id })
    expect(updated.prefs).toMatchObject({ pinned: true, sectionId: section.id })
    expect((await service.getBot('b1')).prefs.pinned).toBe(true)
    expect(log).toEqual([])
    expect(changes()).toBe(2)
  })

  test('preferences for a bot that does not exist are refused', async () => {
    const { service } = fakeService()
    expect(service.setPrefs({ botId: 'ghost', pinned: true })).rejects.toThrow('That bot does not exist.')
  })

  test('creating a bot makes its workspace folder and keeps the chosen avatar', async () => {
    const { service, root } = fakeService()
    const made = await service.createBot({ name: 'Maker', function: '', instructions: '', avatar: { shape: 'star', color: 'teal', faceColor: 'ink' } })
    expect(made.prefs.avatar).toEqual({ shape: 'star', color: 'teal', faceColor: 'ink' })
    expect(made.workspace).toBe(join(root, made.id))
    expect(existsSync(made.workspace)).toBe(true)
  })
})

describe('the main conversation', () => {
  test('is created on first open and is the same chat on every later open', async () => {
    const { service, prefs } = fakeService()
    const first = await service.openChat('b1', undefined, ignore)
    const again = await service.openChat('b1', undefined, ignore)
    expect(again.snapshot.chatId).toBe(first.snapshot.chatId)
    expect(prefs.mainChat('b1')).toBe(first.snapshot.chatId)
  })

  test('runs in the bot’s workspace folder, which is created when needed', async () => {
    const { service, root, log } = fakeService()
    const chat = await service.openChat('b1', undefined, ignore)
    expect(chat.snapshot.workspace).toBe(join(root, 'b1'))
    expect(existsSync(join(root, 'b1'))).toBe(true)
    expect(log).toEqual([`open:${chat.snapshot.chatId}:b1`])
  })

  test('a new session becomes the main conversation; the old one can still be opened by id', async () => {
    const { service, prefs } = fakeService()
    const old = (await service.openChat('b1', undefined, ignore)).snapshot.chatId
    const fresh = (await service.newChat('b1', ignore)).snapshot.chatId
    expect(fresh).not.toBe(old)
    expect(prefs.mainChat('b1')).toBe(fresh)
    expect((await service.openChat('b1', old, ignore)).snapshot.chatId).toBe(old)
    expect(prefs.mainChat('b1')).toBe(fresh)
  })

  test('is replaced when the engine no longer has it', async () => {
    const { service, prefs, stored } = fakeService()
    const lost = (await service.openChat('b1', undefined, ignore)).snapshot.chatId
    stored.delete(lost)
    const replacement = (await service.openChat('b1', undefined, ignore)).snapshot.chatId
    expect(replacement).not.toBe(lost)
    expect(prefs.mainChat('b1')).toBe(replacement)
  })

  test('a bot id that is not a plain id never becomes a folder', async () => {
    const { service } = fakeService()
    expect(service.openChat('../escape', undefined, ignore)).rejects.toThrow('That bot does not exist.')
  })
})

describe('memory', () => {
  test('a new bot is connected to LilBot memory and keeps only what is known about the user', async () => {
    const { service, store, log, memory } = fakeService()
    const made = await service.createBot({ name: 'Maker', function: '', instructions: '' })
    expect(log).toContain(`connect-memory:${store.get(made.id).engineBotId}`)
    const facts = memory.list(made.id)
    expect(facts.find(fact => fact.text === 'Oscar lives in Adelaide.')).toMatchObject({ kind: 'profile', scope: 'shared' })
    expect(facts.map(fact => fact.text)).toEqual(['Oscar lives in Adelaide.'])
    expect(memory.list('other').map(fact => fact.text)).toEqual(['Oscar lives in Adelaide.'])
    expect(made.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('connecting an existing bot keeps its own notes too, and connecting again does not duplicate them', async () => {
    const { service, memory } = fakeService()
    expect(await service.connectMemory('b1')).toEqual({ imported: 3 })
    expect(await service.connectMemory('b1')).toEqual({ imported: 0 })
    expect(memory.list('b1')).toHaveLength(3)
    expect(memory.list('b1').find(fact => fact.text === 'The build takes 30 minutes.')).toMatchObject({ kind: 'profile', scope: 'bot' })
    expect(memory.list('b1').every(fact => fact.text.length <= 500)).toBe(true)
  })

  test('the user can add and forget facts, and open panels are told', async () => {
    const { service, memoryChanges } = fakeService()
    const fact = await service.writeMemory({ botId: 'b1', kind: 'profile', text: 'Prefers tables.' })
    expect(fact).toMatchObject({ author: 'user', scope: 'shared' })
    expect((await service.listMemory('b1')).facts.map(item => item.text)).toEqual(['Prefers tables.'])
    service.forgetMemory(fact.id)
    expect((await service.listMemory('b1')).facts).toEqual([])
    expect(memoryChanges()).toBe(2)
    expect(service.writeMemory({ botId: 'ghost', kind: 'profile', text: 'x' })).rejects.toThrow('That bot does not exist.')
  })
})

test('at start-up every bot that is not on LilBot memory is connected, once', async () => {
  const { service, engine, log } = fakeService()
  expect(await service.connectAllMemory()).toEqual(['b1'])
  engine.applyIdentity = async () => ({ abilities: [], memoryConnected: true })
  expect(await service.connectAllMemory()).toEqual([])
  expect(log.filter(entry => entry.startsWith('connect-memory'))).toEqual(['connect-memory:native-b1'])
})
