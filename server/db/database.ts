/** LeBot's own database: one SQLite file holding only what belongs to LeBot and the user.
 *  Nothing the engine already stores (bots, chats, memory) is copied here. */
import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** Schema changes, in order. Never edit a step that has shipped: add a new one. */
const migrations: string[] = [
  `CREATE TABLE sections (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     position INTEGER NOT NULL
   );
   CREATE TABLE bot_prefs (
     bot_id TEXT PRIMARY KEY,
     avatar_shape TEXT,
     avatar_color TEXT,
     section_id TEXT REFERENCES sections(id) ON DELETE SET NULL,
     pinned INTEGER NOT NULL DEFAULT 0,
     hidden INTEGER NOT NULL DEFAULT 0,
     main_chat_id TEXT
   );`
]

/** `path` may be ':memory:' for tests. Applies any migration steps the file has not seen. */
export function openDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const db = new Database(path, { create: true, strict: true })
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;')

  const applied = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version
  if (applied > migrations.length) throw new Error(`The database is from a newer LeBot (schema ${applied}, this build knows ${migrations.length}).`)
  for (let step = applied; step < migrations.length; step++) {
    db.transaction(() => {
      db.exec(migrations[step])
      db.exec(`PRAGMA user_version = ${step + 1}`)
    })()
  }
  return db
}
