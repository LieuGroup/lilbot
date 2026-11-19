import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BotPrefsStore } from '../../server/bots/bot-prefs-store'
import { openDatabase } from '../../server/database/database'
import { defaultAvatar } from '../../shared/avatar'

const store = () => new BotPrefsStore(openDatabase(':memory:'))

describe('bot preferences', () => {
  test('a bot nobody touched has stable defaults derived from its id', () => {
    const prefs = store().prefs('researcher')
    expect(prefs).toEqual({ avatar: defaultAvatar('researcher'), sectionId: null, pinned: false, hidden: false })
    expect(defaultAvatar('researcher')).toEqual(defaultAvatar('researcher'))
  })

  test('a change keeps the fields it does not mention', () => {
    const prefs = store()
    prefs.setPrefs('b1', { pinned: true })
    prefs.setPrefs('b1', { avatar: { shape: 'star', color: 'blue', faceColor: 'ink' } })
    expect(prefs.prefs('b1')).toMatchObject({ pinned: true, hidden: false, avatar: { shape: 'star', color: 'blue', faceColor: 'ink' } })
  })

  test('prefsFor answers for every requested bot, stored or not', () => {
    const prefs = store()
    prefs.setPrefs('b1', { hidden: true })
    const all = prefs.prefsFor(['b1', 'b2'])
    expect(all.get('b1')?.hidden).toBe(true)
    expect(all.get('b2')).toEqual(prefs.prefs('b2'))
  })

  test('the main chat is kept apart from preferences, and forgetBot removes both', () => {
    const prefs = store()
    expect(prefs.mainChat('b1')).toBeNull()
    prefs.setMainChat('b1', 'chat-1')
    prefs.setPrefs('b1', { pinned: true })
    expect(prefs.mainChat('b1')).toBe('chat-1')
    prefs.setMainChat('b1', 'chat-2')
    expect(prefs.prefs('b1').pinned).toBe(true)
    prefs.forgetBot('b1')
    expect(prefs.mainChat('b1')).toBeNull()
    expect(prefs.prefs('b1').pinned).toBe(false)
  })
})

describe('sections', () => {
  test('are listed in the order they were made, and can be renamed', () => {
    const prefs = store()
    const product = prefs.createSection('Product')
    prefs.createSection('Engineer')
    prefs.renameSection(product.id, 'Products')
    expect(prefs.sections().map(section => section.name)).toEqual(['Products', 'Engineer'])
    expect(() => prefs.renameSection('nope', 'x')).toThrow('That section does not exist.')
  })

  test('a bot can only be put in a section that exists', () => {
    const prefs = store()
    expect(() => prefs.setPrefs('b1', { sectionId: 'nope' })).toThrow('That section does not exist.')
  })

  test('deleting a section leaves its bots without one', () => {
    const prefs = store()
    const section = prefs.createSection('Product')
    prefs.setPrefs('b1', { sectionId: section.id, pinned: true })
    prefs.deleteSection(section.id)
    expect(prefs.prefs('b1')).toMatchObject({ sectionId: null, pinned: true })
    expect(prefs.sections()).toEqual([])
  })
})

test('the database file survives being reopened and is not migrated twice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-db-'))
  try {
    const path = join(dir, 'nested', 'lilbot.db')
    const first = openDatabase(path)
    new BotPrefsStore(first).setMainChat('b1', 'chat-1')
    const prefs = new BotPrefsStore(first)
    expect(prefs.primaryBot()).toBeNull()
    prefs.setPrimaryBot('b1')
    prefs.setPrimaryBot('b2')
    first.close()
    const second = openDatabase(path)
    expect(new BotPrefsStore(second).mainChat('b1')).toBe('chat-1')
    expect(new BotPrefsStore(second).primaryBot()).toBe('b2')
    second.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the primary migration upgrades an existing database without losing preferences', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-migration-'))
  const path = join(dir, 'lilbot.db')
  try {
    const db = openDatabase(path)
    new BotPrefsStore(db).setPrefs('b1', { pinned: true })
    db.exec(
      'DROP TABLE computer_payloads; DROP TABLE computer_requests; DROP TABLE computer_bytes; DROP TABLE computer_nonces; DROP TABLE computer_codes; DROP TABLE computers; DROP TABLE thread_chats; DROP TABLE thread_deliveries; DROP TABLE threads; ALTER TABLE bot_prefs DROP COLUMN avatar_face_color; DROP TABLE library_items; DROP TABLE skills; DROP TABLE skill_off; DROP TABLE skill_imports; DROP TABLE routine_chats; DROP TABLE routine_runs; DROP TABLE routines; DROP TABLE bot_creations; DROP TABLE bot_delete_defaults; DROP TABLE bots; DROP TABLE bot_imports; DROP TABLE primary_bot; DROP TABLE bot_activity; DROP TABLE activity_cursors; DROP TABLE IF EXISTS attachment_messages; DROP TABLE IF EXISTS attachments; PRAGMA user_version = 3'
    )
    db.close()
    const upgraded = openDatabase(path)
    const prefs = new BotPrefsStore(upgraded)
    expect(prefs.primaryBot()).toBeNull()
    expect(prefs.prefs('b1').pinned).toBe(true)
    prefs.setPrimaryBot('b1')
    expect(prefs.primaryBot()).toBe('b1')
    expect((upgraded.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(17)
    upgraded.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('upgrading the shipped creation schema preserves markers before adding deletion', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-upgrade-'))
  const path = join(dir, 'lilbot.db')
  try {
    const db = openDatabase(path)
    db.exec(
      "INSERT INTO bot_creations VALUES ('created-before-upgrade'); DROP TABLE computer_payloads; DROP TABLE computer_requests; DROP TABLE computer_bytes; DROP TABLE computer_nonces; DROP TABLE computer_codes; DROP TABLE computers; DROP TABLE thread_chats; DROP TABLE thread_deliveries; DROP TABLE threads; ALTER TABLE bot_prefs DROP COLUMN avatar_face_color; DROP TABLE library_items; DROP TABLE skills; DROP TABLE skill_off; DROP TABLE skill_imports; DROP TABLE routine_chats; DROP TABLE routine_runs; DROP TABLE routines; ALTER TABLE bots DROP COLUMN permission_mode; DROP TABLE bot_delete_defaults; ALTER TABLE bots DROP COLUMN deletion; DROP TABLE IF EXISTS attachment_messages; DROP TABLE IF EXISTS attachments; PRAGMA user_version = 7"
    )
    db.close()
    const upgraded = openDatabase(path)
    expect(upgraded.query('SELECT bot_id FROM bot_creations').all()).toEqual([{ bot_id: 'created-before-upgrade' }])
    expect((upgraded.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(17)
    expect(new BotPrefsStore(upgraded).primaryBot()).toBeNull()
    upgraded.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('old avatars read with an ink face without rewriting the stored row', () => {
  const db = openDatabase(':memory:')
  db.query('INSERT INTO bot_prefs (bot_id, avatar_shape, avatar_color) VALUES (?, ?, ?)').run('legacy', 'triangle', 'yellow')
  const prefs = new BotPrefsStore(db)
  expect(prefs.prefs('legacy').avatar).toEqual({ shape: 'triangle', color: 'yellow', faceColor: 'ink' })
  expect(prefs.prefsFor(['legacy']).get('legacy')?.avatar.faceColor).toBe('ink')
  expect(db.query('SELECT avatar_face_color FROM bot_prefs').get()).toEqual({ avatar_face_color: null })
  prefs.setPrefs('legacy', { avatar: { shape: 'drop', color: 'bone', faceColor: 'pink' } })
  expect(prefs.prefs('legacy').avatar).toEqual({ shape: 'drop', color: 'bone', faceColor: 'pink' })
  db.close()
})
