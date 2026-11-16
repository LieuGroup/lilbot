import { expect, test } from 'bun:test'
import { methods } from '../../shared/protocol'
import { fakeService } from '../helpers/fake-engine'

test('existing and new bots default to full access; protocol retains the requested mode', async () => {
  const { service, store } = fakeService()
  expect(store.get('b1').permissionMode).toBe('full-access')
  const bot = await service.createBot({ name: 'New', function: '', instructions: '' })
  expect(bot.permissionMode).toBe('full-access')
  expect(methods['bots.update'].parse({ botId: bot.id, permissionMode: 'auto' }).permissionMode).toBe('auto')
})

test('unsupported modes are refused before creating or changing durable identity', async () => {
  const { service, store, engine } = fakeService()
  let created = false
  engine.createRuntime = async () => {
    created = true
    return 'bad'
  }
  await expect(service.createBot({ name: 'No', function: '', instructions: '', permissionMode: 'auto' })).rejects.toThrow('does not support permission mode "auto"')
  await expect(service.updateBot({ botId: 'b1', permissionMode: 'approval-required' })).rejects.toThrow('does not support')
  expect(store.list()).toHaveLength(1)
  expect(store.get('b1').permissionMode).toBe('full-access')
  expect(created).toBe(false)
})

test('saved mode reaches engine for roster startup, updates, chats and reviews', async () => {
  const { service, engine } = fakeService()
  let applied = 0
  engine.applyIdentity = async (_id, identity) => {
    expect(identity.permissionMode).toBe('full-access')
    applied++
    return { abilities: [], memoryConnected: false }
  }
  await service.listBots()
  await service.updateBot({ botId: 'b1', permissionMode: 'full-access' })
  const chat = await service.openChat('b1', undefined, () => {})
  chat.close()
  await service.reviewMemory('b1', 'Review', { onChat: () => {} })
  expect(applied).toBeGreaterThanOrEqual(4)
})

test('migration gives an existing identity full access without losing fields', async () => {
  const { Database } = await import('bun:sqlite')
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { homedir } = await import('node:os')
  const { join } = await import('node:path')
  const { openDatabase } = await import('../../server/database/database')
  const { BotStore } = await import('../../server/bots/bot-store')
  const dir = mkdtempSync(join(homedir(), 'agent-tmp/lilbot-mode-'))
  try {
    const path = join(dir, 'old.db')
    const old = new Database(path)
    old.exec(`CREATE TABLE bots (id TEXT PRIMARY KEY, name TEXT, function TEXT, instructions TEXT, model TEXT,
      is_default INTEGER, engine_id TEXT, engine_bot_id TEXT);
      INSERT INTO bots VALUES ('old', 'Existing', 'work', 'instructions', NULL, 0, 'test', 'native');
      PRAGMA user_version = 6;`)
    old.close()
    const db = openDatabase(path)
    expect(new BotStore(db).get('old')).toMatchObject({ name: 'Existing', instructions: 'instructions', permissionMode: 'full-access', engineBotId: 'native' })
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
