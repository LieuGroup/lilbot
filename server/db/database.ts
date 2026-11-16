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
   );`,
  // Memory: facts are never erased by "forget", only marked, so the history stays reviewable.
  `CREATE TABLE memory_facts (
     id TEXT PRIMARY KEY,
     bot_id TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('profile', 'journal')),
     scope TEXT NOT NULL CHECK (scope IN ('bot', 'shared')),
     text TEXT NOT NULL,
     author TEXT NOT NULL CHECK (author IN ('bot', 'user')),
     learned_at INTEGER NOT NULL,
     forgotten_at INTEGER
   );
   CREATE INDEX memory_facts_visible ON memory_facts (scope, bot_id, kind, learned_at) WHERE forgotten_at IS NULL;
   CREATE VIRTUAL TABLE memory_search USING fts5 (text, content = 'memory_facts', content_rowid = 'rowid');
   CREATE TRIGGER memory_facts_added AFTER INSERT ON memory_facts BEGIN
     INSERT INTO memory_search (rowid, text) VALUES (new.rowid, new.text);
   END;
   CREATE TRIGGER memory_facts_removed AFTER DELETE ON memory_facts BEGIN
     INSERT INTO memory_search (memory_search, rowid, text) VALUES ('delete', old.rowid, old.text);
   END;`
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
