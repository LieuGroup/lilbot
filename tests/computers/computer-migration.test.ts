import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../server/database/database'

test('migration 15 preserves shipped threads and adds computer tables', () => {
  const root = mkdtempSync(join(tmpdir(), 'computer-migration-'))
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
      PRAGMA user_version = 14;
    `)
    db.close()
    db = openDatabase(path)
    expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: 15 })
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
