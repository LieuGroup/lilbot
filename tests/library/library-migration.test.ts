import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { BotStore } from '../../server/bots/bot-store'
import { openDatabase } from '../../server/database/database'
import { RoutineStore } from '../../server/routines/routine-store'
import { detail } from '../helpers/fake-engine'

test('library migration preserves shipped routines and their run aliases', () => {
  const root = mkdtempSync(join(homedir(), 'agent-tmp', 'library-migration-'))
  const path = join(root, 'db')
  let db = openDatabase(path)
  try {
    new BotStore(db).import('test', [{ ...detail, engineId: 'test', engineBotId: 'b1' }])
    const store = new RoutineStore(db)
    store.create('b1', { requestId: 'one', description: 'Check', schedule: { kind: 'interval', seconds: 300 }, createdBy: 'oscar' }, 0, 5)
    const [run] = store.claimDue(300_000)
    store.attach(run.id, 'stored', 300_000)
    db.exec(
      'DROP TABLE computer_payloads; DROP TABLE computer_requests; DROP TABLE computer_bytes; DROP TABLE computer_nonces; DROP TABLE computer_codes; DROP TABLE computers; DROP TABLE thread_chats; DROP TABLE thread_deliveries; DROP TABLE threads; ALTER TABLE bot_prefs DROP COLUMN avatar_face_color; DROP TABLE skills; DROP TABLE skill_off; DROP TABLE skill_imports; DROP TABLE library_items; DROP TABLE IF EXISTS history_search; DROP TABLE IF EXISTS history_items; DROP TABLE IF EXISTS history_sessions; DROP TABLE IF EXISTS history_events; DROP TABLE IF EXISTS history_imports; DROP TABLE IF EXISTS attachment_messages; DROP TABLE IF EXISTS attachments; PRAGMA user_version = 10'
    )
    db.close()
    db = openDatabase(path)
    expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: 21 })
    expect(new RoutineStore(db).runForChat('b1', 'stored')).toBe(run.id)
    expect(db.query('SELECT * FROM library_items').all()).toEqual([])
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})
