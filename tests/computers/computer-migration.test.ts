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
      DROP TABLE computer_payloads;
      DROP TABLE computer_requests;
      DROP TABLE computer_bytes;
      DROP TABLE computer_nonces;
      DROP TABLE computer_codes;
      DROP TABLE computers;
      DROP TABLE IF EXISTS history_search; DROP TABLE IF EXISTS history_items; DROP TABLE IF EXISTS history_sessions; DROP TABLE IF EXISTS history_events; DROP TABLE IF EXISTS history_imports; DROP TABLE IF EXISTS attachment_messages; DROP TABLE IF EXISTS attachments; PRAGMA user_version = 14;
    `)
    db.close()
    db = openDatabase(path)
    expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: 19 })
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
    db.exec(`DROP INDEX computer_bot_active;
      ALTER TABLE computer_requests DROP COLUMN final_frames;
      ALTER TABLE computer_requests DROP COLUMN received_bytes;
      INSERT INTO computers(id,hello) VALUES('remote','{}');
      INSERT INTO computer_requests(id,bot_id,computer_id,request_id,created_at,digest,size,payload_bytes)
        VALUES('request','bot','remote','user-id',1,'digest',12,42);
      INSERT INTO computer_payloads VALUES('request','operation','result');
      DROP TABLE IF EXISTS history_search; DROP TABLE IF EXISTS history_items; DROP TABLE IF EXISTS history_sessions; DROP TABLE IF EXISTS history_events; DROP TABLE IF EXISTS history_imports; DROP TABLE IF EXISTS attachment_messages; DROP TABLE IF EXISTS attachments; PRAGMA user_version = 15;`)
    db.close()
    db = openDatabase(path)
    expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: 19 })
    expect(db.query('SELECT final_frames,received_bytes,payload_bytes FROM computer_requests').get()).toEqual({ final_frames: 0, received_bytes: 0, payload_bytes: 42 })
    expect(db.query('SELECT * FROM computer_payloads').get()).toEqual({ id: 'request', operation: 'operation', result: 'result' })
    expect(db.query("SELECT bytes FROM computer_bytes WHERE bot_id='bot'").get()).toEqual({ bytes: 42 })
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})
