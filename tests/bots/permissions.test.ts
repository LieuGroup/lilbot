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
  await service.prepareRuntimes()
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
    old.exec(`CREATE TABLE bot_prefs (bot_id TEXT PRIMARY KEY, avatar_shape TEXT, avatar_color TEXT, pinned INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE bots (id TEXT PRIMARY KEY, name TEXT, function TEXT, instructions TEXT, model TEXT,
      is_default INTEGER, engine_id TEXT, engine_bot_id TEXT);
      INSERT INTO bots VALUES ('old', 'Existing', 'work', 'instructions', NULL, 0, 'test', 'native');
      DROP TABLE IF EXISTS history_search; DROP TABLE IF EXISTS history_items; DROP TABLE IF EXISTS history_sessions; DROP TABLE IF EXISTS history_events; DROP TABLE IF EXISTS history_imports; DROP TABLE IF EXISTS attachment_messages; DROP TABLE IF EXISTS attachments; PRAGMA user_version = 6;`)
    old.close()
    const db = openDatabase(path)
    expect(new BotStore(db).get('old')).toMatchObject({ name: 'Existing', instructions: 'instructions', permissionMode: 'full-access', engineBotId: 'native' })
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('shipped deletion schema upgrades without changing tombstones or deletion defaults', async () => {
  const { openDatabase } = await import('../../server/database/database')
  const { BotStore } = await import('../../server/bots/bot-store')
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { homedir } = await import('node:os')
  const { join } = await import('node:path')
  const root = mkdtempSync(join(homedir(), 'agent-tmp/lilbot-deletion-upgrade-'))
  try {
    const path = join(root, 'db')
    const db = openDatabase(path)
    const store = new BotStore(db)
    store.save({
      id: 'deleted',
      name: 'Remembered',
      function: '',
      instructions: '',
      model: null,
      isDefault: false,
      reasoningEffort: null,
      permissionMode: 'full-access',
      engineId: 'test',
      engineBotId: 'native'
    })
    const choices = { files: 'delete' as const, privateMemories: 'keep' as const }
    store.markDeleted(store.get('deleted'), choices)
    store.setDeleteDefaults(choices)
    db.exec(
      'ALTER TABLE bots DROP COLUMN reasoning_effort; DROP TABLE library_items; DROP TABLE computer_payloads; DROP TABLE computer_requests; DROP TABLE computer_bytes; DROP TABLE computer_nonces; DROP TABLE computer_codes; DROP TABLE computers; DROP TABLE thread_chats; DROP TABLE thread_deliveries; DROP TABLE threads; ALTER TABLE bot_prefs DROP COLUMN pinned_at; ALTER TABLE bot_prefs DROP COLUMN avatar_face_color; DROP TABLE skills; DROP TABLE skill_off; DROP TABLE skill_imports; DROP TABLE routine_chats; DROP TABLE routine_runs; DROP TABLE routines; ALTER TABLE bots DROP COLUMN permission_mode; DROP TABLE IF EXISTS history_search; DROP TABLE IF EXISTS history_items; DROP TABLE IF EXISTS history_sessions; DROP TABLE IF EXISTS history_events; DROP TABLE IF EXISTS history_imports; DROP TABLE IF EXISTS attachment_messages; DROP TABLE IF EXISTS attachments; ALTER TABLE work_items DROP COLUMN kind; ALTER TABLE work_items DROP COLUMN default_level; ALTER TABLE webhooks DROP COLUMN capabilities; ALTER TABLE webhook_runs DROP COLUMN message; ALTER TABLE webhook_runs DROP COLUMN message_state; DROP INDEX work_items_goal; ALTER TABLE work_items DROP COLUMN goal_id; ALTER TABLE work_checks DROP COLUMN same_bot; ALTER TABLE work_checks DROP COLUMN checker_model; PRAGMA user_version = 8'
    )
    db.close()
    const upgraded = openDatabase(path)
    const restored = new BotStore(upgraded)
    expect(restored.list()).toEqual([])
    expect(restored.deleted('deleted')).toMatchObject({ bot: { name: 'Remembered', permissionMode: 'full-access' }, choices })
    expect(restored.deleteDefaults()).toEqual(choices)
    expect(upgraded.query('PRAGMA user_version').get()).toEqual({ user_version: 37 })
    upgraded.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
