import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../server/database/database'

test('migration 15 preserves shipped threads and adds computer tables', () => {
  const root = mkdtempSync(join(homedir(), 'agent-tmp/computer-migration-'))
  const path = join(root, 'test.db')
  let db = openDatabase(path)
  try {
    db.exec(`
      INSERT INTO threads VALUES ('thread', '{"messages":[]}');
      INSERT INTO thread_chats VALUES ('chat', 'bot', 'thread');
      ALTER TABLE bots DROP COLUMN reasoning_effort;
      DROP TABLE computer_payloads;
      DROP TABLE computer_requests;
      DROP TABLE computer_bytes;
      DROP TABLE computer_nonces;
      DROP TABLE computer_codes;
      DROP TABLE computers;
      DROP TABLE IF EXISTS history_search; DROP TABLE IF EXISTS history_items; DROP TABLE IF EXISTS history_sessions; DROP TABLE IF EXISTS history_events; DROP TABLE IF EXISTS history_imports; DROP TABLE IF EXISTS attachment_messages; DROP TABLE IF EXISTS attachments; ALTER TABLE bot_prefs DROP COLUMN pinned_at; ALTER TABLE work_items DROP COLUMN kind; ALTER TABLE work_items DROP COLUMN default_level; PRAGMA user_version = 14;
    `)
    db.close()
    db = openDatabase(path)
    expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: 31 })
    expect(db.query('SELECT * FROM threads').all()).toEqual([{ id: 'thread', data: '{"messages":[]}' }])
    expect(db.query('SELECT * FROM thread_chats').all()).toEqual([{ chat_id: 'chat', bot_id: 'bot', thread_id: 'thread' }])
    for (const table of ['thread_deliveries', 'computers', 'computer_codes', 'computer_nonces', 'computer_requests']) {
      expect(db.query(`SELECT * FROM ${table}`).all()).toEqual([])
    }
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('migration 16 preserves schema 15 requests and payloads with zeroed receive allowances', () => {
  const root = mkdtempSync(join(homedir(), 'agent-tmp/computer-migration-'))
  const path = join(root, 'test.db')
  let db = openDatabase(path)
  try {
    db.exec(`ALTER TABLE bots DROP COLUMN reasoning_effort; DROP INDEX computer_bot_active;
      ALTER TABLE computer_requests DROP COLUMN final_frames;
      ALTER TABLE computer_requests DROP COLUMN received_bytes;
      INSERT INTO computers(id,hello) VALUES('remote','{}');
      INSERT INTO computer_requests(id,bot_id,computer_id,request_id,created_at,digest,size,payload_bytes)
        VALUES('request','bot','remote','user-id',1,'digest',12,42);
      INSERT INTO computer_payloads VALUES('request','operation','result');
      DROP TABLE IF EXISTS history_search; DROP TABLE IF EXISTS history_items; DROP TABLE IF EXISTS history_sessions; DROP TABLE IF EXISTS history_events; DROP TABLE IF EXISTS history_imports; DROP TABLE IF EXISTS attachment_messages; DROP TABLE IF EXISTS attachments; ALTER TABLE bot_prefs DROP COLUMN pinned_at; ALTER TABLE work_items DROP COLUMN kind; ALTER TABLE work_items DROP COLUMN default_level; PRAGMA user_version = 15;`)
    db.close()
    db = openDatabase(path)
    expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: 31 })
    expect(db.query('SELECT final_frames,received_bytes,payload_bytes FROM computer_requests').get()).toEqual({ final_frames: 0, received_bytes: 0, payload_bytes: 42 })
    expect(db.query('SELECT * FROM computer_payloads').get()).toEqual({ id: 'request', operation: 'operation', result: 'result' })
    expect(db.query("SELECT bytes FROM computer_bytes WHERE bot_id='bot'").get()).toEqual({ bytes: 42 })
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('migration 24 adds the devices tables without touching computers, can run again, and allows one main computer', () => {
  const root = mkdtempSync(join(homedir(), 'agent-tmp/computer-migration-'))
  const path = join(root, 'test.db')
  let db = openDatabase(path)
  try {
    db.exec(`INSERT INTO computers(id,hello) VALUES('remote','{"name":"Remote"}');
      INSERT INTO computer_attempts(id,code_id,expires_at,computer_id) VALUES('attempt','code',1,'remote');
      INSERT INTO main_computer VALUES(1,'remote');
      ALTER TABLE bots DROP COLUMN reasoning_effort; ALTER TABLE work_items DROP COLUMN kind; ALTER TABLE work_items DROP COLUMN default_level; PRAGMA user_version = 23;`)
    db.close()
    db = openDatabase(path)
    expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: 31 })
    expect(db.query('SELECT id FROM computers').all()).toEqual([{ id: 'remote' }])
    expect(db.query('SELECT id,computer_id FROM computer_attempts').all()).toEqual([{ id: 'attempt', computer_id: 'remote' }])
    expect(db.query('SELECT computer_id FROM main_computer').all()).toEqual([{ computer_id: 'remote' }])
    for (const table of ['devices', 'message_origins', 'computer_attempt_devices']) expect(db.query(`SELECT * FROM ${table}`).all()).toEqual([])
    expect(() => db.exec("INSERT INTO main_computer VALUES(2,'other')")).toThrow()
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})
