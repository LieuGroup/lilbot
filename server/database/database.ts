/** LilBot owns bot identity, engine bindings, preferences and memory. Chats stay with engines. */
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
   END;`,
  // Memory review: where a fact came from, pausing, expiry, and the turns waiting to be reviewed.
  `ALTER TABLE memory_facts ADD COLUMN via TEXT NOT NULL DEFAULT 'chat' CHECK (via IN ('chat', 'review', 'app', 'import'));
   ALTER TABLE memory_facts ADD COLUMN source_chat_id TEXT;
   ALTER TABLE memory_facts ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE memory_facts ADD COLUMN expires_at INTEGER;
   ALTER TABLE memory_facts ADD COLUMN forgotten_by TEXT;
   CREATE TABLE review_turns (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     bot_id TEXT NOT NULL,
     chat_id TEXT NOT NULL,
     user_text TEXT NOT NULL,
     assistant_text TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX review_turns_bot ON review_turns (bot_id, id);`,
  // One user-selected primary, independent of the engine and per-bot preferences.
  `CREATE TABLE primary_bot (id INTEGER PRIMARY KEY CHECK (id = 1), bot_id TEXT NOT NULL);`,
  `CREATE TABLE bot_activity (bot_id TEXT PRIMARY KEY, unread INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE activity_cursors (bot_id TEXT NOT NULL, chat_id TEXT NOT NULL, event_key TEXT NOT NULL, PRIMARY KEY (bot_id, chat_id));`,
  // Stable identity; legacy ids keep all existing preferences, memory and chat pointers intact.
  `CREATE TABLE bots (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, function TEXT NOT NULL, instructions TEXT NOT NULL,
     model TEXT, is_default INTEGER NOT NULL DEFAULT 0,
     engine_id TEXT NOT NULL, engine_bot_id TEXT NOT NULL,
     UNIQUE(engine_id, engine_bot_id)
   );
   CREATE TABLE bot_imports (engine_id TEXT PRIMARY KEY);`,
  `CREATE TABLE bot_creations (bot_id TEXT PRIMARY KEY);`,
  `ALTER TABLE bots ADD COLUMN deletion TEXT;
   CREATE TABLE bot_delete_defaults (id INTEGER PRIMARY KEY CHECK (id = 1), files TEXT NOT NULL, private_memories TEXT NOT NULL);`,
  `ALTER TABLE bots ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'full-access';`,
  // Routines and their durable execution identities belong to LilBot, not the engine.
  `CREATE TABLE routines (
     id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), request_id TEXT NOT NULL,
     description TEXT NOT NULL, schedule TEXT NOT NULL, created_by TEXT NOT NULL,
     paused INTEGER NOT NULL DEFAULT 0, last_run_at INTEGER, next_run_at INTEGER NOT NULL,
     deleted INTEGER NOT NULL DEFAULT 0, UNIQUE(bot_id, request_id)
   );
   CREATE TABLE routine_runs (
     id TEXT PRIMARY KEY, routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
     bot_id TEXT NOT NULL, due_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER,
     chat_id TEXT, status TEXT NOT NULL DEFAULT 'pending', result TEXT NOT NULL DEFAULT '',
     UNIQUE(routine_id, due_at)
   );
   CREATE INDEX routine_runs_pending ON routine_runs(status);
   CREATE TABLE routine_chats (chat_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES routine_runs(id) ON DELETE CASCADE);`,
  `CREATE TABLE library_items (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, title TEXT NOT NULL, path TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('media', 'file', 'page')), size INTEGER NOT NULL, created_at INTEGER NOT NULL, chat_id TEXT, routine_run_id TEXT);
   CREATE INDEX library_bot_time ON library_items(bot_id, created_at DESC);`,
  `CREATE TABLE skills (name TEXT PRIMARY KEY, description TEXT NOT NULL, author TEXT NOT NULL, updated_at INTEGER NOT NULL);
   CREATE TABLE skill_off (bot_id TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(bot_id,name));
   CREATE TABLE skill_imports (source TEXT PRIMARY KEY, name TEXT NOT NULL);`,
  `ALTER TABLE bot_prefs ADD COLUMN avatar_face_color TEXT;`,
  `CREATE TABLE threads (id TEXT PRIMARY KEY, data TEXT NOT NULL);
   CREATE TABLE thread_deliveries (
     id TEXT PRIMARY KEY, threadId TEXT NOT NULL, sender TEXT NOT NULL, target TEXT NOT NULL,
     sourceChat TEXT NOT NULL, text TEXT NOT NULL, kind TEXT NOT NULL, chatId TEXT, base INTEGER,
     status TEXT NOT NULL DEFAULT 'pending'
   );
   CREATE TABLE thread_chats (chat_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, thread_id TEXT NOT NULL);`,
  // Native computers: revocable public keys, one-use bootstrap and durable request identities.
  `CREATE TABLE computers (id TEXT PRIMARY KEY, hello TEXT NOT NULL, public_key TEXT, last_seen INTEGER, key_conflict INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE computer_codes (hash TEXT PRIMARY KEY, secret TEXT NOT NULL, expires_at INTEGER NOT NULL, name TEXT NOT NULL);
   CREATE TABLE computer_nonces (computer_id TEXT NOT NULL, nonce TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(computer_id,nonce));
   CREATE TABLE computer_requests (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, computer_id TEXT NOT NULL REFERENCES computers(id), request_id TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, digest TEXT NOT NULL, size INTEGER NOT NULL,
     background INTEGER NOT NULL DEFAULT 0, cancel_requested INTEGER NOT NULL DEFAULT 0, expires_at INTEGER, payload_bytes INTEGER NOT NULL DEFAULT 0, UNIQUE(bot_id,computer_id,request_id));
   CREATE INDEX computer_nonce_expiry ON computer_nonces(expires_at);
   CREATE INDEX computer_code_expiry ON computer_codes(expires_at);
   CREATE TABLE computer_bytes (bot_id TEXT PRIMARY KEY, bytes INTEGER NOT NULL DEFAULT 0);
   INSERT INTO computer_bytes VALUES ('',0);
   CREATE TRIGGER computer_bytes_insert AFTER INSERT ON computer_requests BEGIN
     INSERT INTO computer_bytes VALUES (NEW.bot_id,NEW.payload_bytes) ON CONFLICT(bot_id) DO UPDATE SET bytes=bytes+NEW.payload_bytes;
     UPDATE computer_bytes SET bytes=bytes+NEW.payload_bytes WHERE bot_id='';
   END;
   CREATE TRIGGER computer_bytes_update AFTER UPDATE OF payload_bytes ON computer_requests BEGIN
     UPDATE computer_bytes SET bytes=bytes+NEW.payload_bytes-OLD.payload_bytes WHERE bot_id IN ('',NEW.bot_id);
   END;
   CREATE INDEX computer_pending ON computer_requests(computer_id,status,created_at);
   CREATE INDEX computer_bot_pending ON computer_requests(bot_id,computer_id,status);
   CREATE INDEX computer_expiry ON computer_requests(expires_at) WHERE expires_at IS NOT NULL;
   CREATE TABLE computer_payloads (id TEXT PRIMARY KEY REFERENCES computer_requests(id) ON DELETE CASCADE, operation TEXT, result TEXT);`,
  // Durable receive allowances and an active-only bot index (schema 15 has shipped).
  `ALTER TABLE computer_requests ADD COLUMN final_frames INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE computer_requests ADD COLUMN received_bytes INTEGER NOT NULL DEFAULT 0;
   CREATE INDEX computer_bot_active ON computer_requests(bot_id,status) WHERE status IN ('pending','running');`
]

/** `path` may be ':memory:' for tests. Applies any migration steps the file has not seen. */
export function openDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const db = new Database(path, { create: true, strict: true })
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;')

  const applied = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version
  if (applied > migrations.length) throw new Error(`The database is from a newer LilBot (schema ${applied}, this build knows ${migrations.length}).`)
  for (let step = applied; step < migrations.length; step++) {
    db.transaction(() => {
      db.exec(migrations[step])
      db.exec(`PRAGMA user_version = ${step + 1}`)
    })()
  }
  return db
}
