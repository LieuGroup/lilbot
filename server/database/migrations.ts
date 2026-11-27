import * as tables from './table-definitions'

/** LilBot's schema: every shipped step, in order. Never edit a shipped step: add one. */
export const migrations: string[] = [
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
   CREATE INDEX computer_bot_active ON computer_requests(bot_id,status) WHERE status IN ('pending','running');`,
  `CREATE TABLE attachments (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, data TEXT NOT NULL);
   CREATE TABLE attachment_messages (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, chat_id TEXT NOT NULL, data TEXT NOT NULL);`,
  `CREATE TABLE history_sessions(bot TEXT NOT NULL,id TEXT NOT NULL,at INTEGER NOT NULL,cursor TEXT,complete INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(bot,id));
   CREATE TABLE history_imports(bot TEXT PRIMARY KEY);
   CREATE TABLE history_items(bot TEXT NOT NULL,session TEXT NOT NULL,id TEXT NOT NULL,at INTEGER NOT NULL,position INTEGER NOT NULL,item TEXT NOT NULL,text TEXT NOT NULL,UNIQUE(bot,id));
   CREATE INDEX history_order ON history_items(bot,session,at,position);
   CREATE INDEX history_session_order ON history_sessions(bot,at,id);
   CREATE TABLE history_events(bot TEXT NOT NULL,session TEXT NOT NULL,at INTEGER NOT NULL,event TEXT NOT NULL,key TEXT NOT NULL,UNIQUE(bot,session,key));
   CREATE VIRTUAL TABLE history_search USING fts5(text,content='history_items',content_rowid='rowid');
   CREATE TRIGGER history_added AFTER INSERT ON history_items BEGIN INSERT INTO history_search(rowid,text) VALUES(new.rowid,new.text); END;
   CREATE TRIGGER history_removed AFTER DELETE ON history_items BEGIN INSERT INTO history_search(history_search,rowid,text) VALUES('delete',old.rowid,old.text); END;
   CREATE TRIGGER history_updated AFTER UPDATE ON history_items BEGIN
     INSERT INTO history_search(history_search,rowid,text) VALUES('delete',old.rowid,old.text);
     INSERT INTO history_search(rowid,text) VALUES(new.rowid,new.text); END;`,
  // Revisit old transcripts once to backfill tool rows omitted by the row_id-only importer.
  `UPDATE history_sessions SET cursor=NULL,complete=0;`,
  // Engine sessions the operator removed from LilBot's copy; every history writer skips them forever.
  `CREATE TABLE IF NOT EXISTS history_exclusions(bot TEXT NOT NULL,session TEXT NOT NULL,reason TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(bot,session));`,
  // Which bot changed what through LilBot's own MCP server (`server/system/`).
  `CREATE TABLE IF NOT EXISTS system_changes(id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,bot_id TEXT NOT NULL,bot_name TEXT NOT NULL,tool TEXT NOT NULL,target TEXT NOT NULL,fields TEXT NOT NULL);`,
  // When each bot was pinned. Bots pinned before this get the migration time, a millisecond apart in name order.
  `ALTER TABLE bot_prefs ADD COLUMN pinned_at INTEGER;
   UPDATE bot_prefs SET pinned_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) + ranked.position
   FROM (SELECT p.bot_id, ROW_NUMBER() OVER (ORDER BY COALESCE(b.name, p.bot_id) COLLATE NOCASE, p.bot_id) - 1 AS position
         FROM bot_prefs p LEFT JOIN bots b ON b.id = p.bot_id WHERE p.pinned = 1) AS ranked
   WHERE bot_prefs.bot_id = ranked.bot_id;`,
  `CREATE TABLE IF NOT EXISTS computer_attempts(id TEXT PRIMARY KEY,code_id TEXT NOT NULL UNIQUE,expires_at INTEGER NOT NULL,computer_id TEXT);
   CREATE INDEX IF NOT EXISTS computer_attempt_expiry ON computer_attempts(expires_at);`,
  // "My computer" (#115): main computer, devices, add-attempt device and plain message origins. Every statement is repeatable.
  `CREATE TABLE IF NOT EXISTS main_computer(only INTEGER PRIMARY KEY CHECK(only = 1), computer_id TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS computer_attempt_devices(code_id TEXT PRIMARY KEY, device_id TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, name TEXT NOT NULL, computer_id TEXT, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS message_origins(id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, text TEXT NOT NULL, device_id TEXT NOT NULL, device_name TEXT NOT NULL, at INTEGER NOT NULL, row_id TEXT);
   CREATE INDEX IF NOT EXISTS message_origins_pending ON message_origins(bot_id, at) WHERE row_id IS NULL;
   CREATE UNIQUE INDEX IF NOT EXISTS message_origins_row ON message_origins(bot_id, row_id) WHERE row_id IS NOT NULL;`,
  `ALTER TABLE bots ADD COLUMN reasoning_effort TEXT;`,
  `CREATE TABLE IF NOT EXISTS thread_links(thread_id TEXT PRIMARY KEY, batch_id TEXT, parent_id TEXT);
   CREATE INDEX IF NOT EXISTS thread_links_batch ON thread_links(batch_id) WHERE batch_id IS NOT NULL;
   CREATE INDEX IF NOT EXISTS thread_links_parent ON thread_links(parent_id) WHERE parent_id IS NOT NULL;
   CREATE TABLE IF NOT EXISTS thread_files(id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, message_id TEXT NOT NULL, sender TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT, source TEXT NOT NULL, copy TEXT, at INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS thread_files_thread ON thread_files(thread_id);
   CREATE TABLE IF NOT EXISTS thread_waits(id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, chat_id TEXT NOT NULL, thread_ids TEXT NOT NULL, delivery_id TEXT, done INTEGER NOT NULL DEFAULT 0);`,
  `CREATE TABLE IF NOT EXISTS engine_skills(engine_id TEXT PRIMARY KEY, included INTEGER NOT NULL);
   INSERT OR IGNORE INTO engine_skills SELECT DISTINCT engine_id, 1 FROM bots;
   CREATE TABLE IF NOT EXISTS skill_origins(name TEXT PRIMARY KEY, engine_id TEXT NOT NULL);
   INSERT OR IGNORE INTO skill_origins SELECT i.name, (SELECT MIN(engine_id) FROM bots) FROM skill_imports i
     WHERE i.name <> '' AND (SELECT COUNT(DISTINCT engine_id) FROM bots) = 1 AND i.name IN (SELECT name FROM skills WHERE author NOT IN ('oscar', 'lilbot'));`,
  `CREATE TABLE IF NOT EXISTS work_items(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, owner_name TEXT NOT NULL, request_id TEXT, title TEXT NOT NULL, done TEXT NOT NULL DEFAULT '', check_level INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL,
     asked_kind TEXT NOT NULL, asked_id TEXT, asked_name TEXT NOT NULL, origin_kind TEXT NOT NULL, origin_id TEXT NOT NULL, chat_id TEXT, parent_id TEXT, question TEXT, result TEXT NOT NULL DEFAULT '', drop_reason TEXT,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER, UNIQUE(owner_id, request_id));
   CREATE INDEX IF NOT EXISTS work_items_updated ON work_items(updated_at DESC); CREATE INDEX IF NOT EXISTS work_items_owner ON work_items(owner_id, status); CREATE INDEX IF NOT EXISTS work_items_parent ON work_items(parent_id) WHERE parent_id IS NOT NULL;
   CREATE TABLE IF NOT EXISTS work_evidence(id TEXT PRIMARY KEY, item_id TEXT NOT NULL, proves TEXT NOT NULL, pointer TEXT NOT NULL, by_id TEXT NOT NULL, at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS work_evidence_item ON work_evidence(item_id);
   CREATE TABLE IF NOT EXISTS work_events(id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL, at INTEGER NOT NULL, by_kind TEXT NOT NULL, kind TEXT NOT NULL, status TEXT, text TEXT, via_kind TEXT, via_id TEXT); CREATE INDEX IF NOT EXISTS work_events_item ON work_events(item_id, id);
   CREATE TABLE IF NOT EXISTS work_answers(id TEXT PRIMARY KEY, item_id TEXT NOT NULL, bot_id TEXT NOT NULL, chat_id TEXT, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending');`,
  tables.WEBHOOK_TABLES,
  `ALTER TABLE work_items ADD COLUMN kind TEXT;
   ALTER TABLE work_items ADD COLUMN default_level INTEGER;
   CREATE TABLE IF NOT EXISTS work_checks(id TEXT PRIMARY KEY, item_id TEXT NOT NULL, round INTEGER NOT NULL, checker_kind TEXT NOT NULL, checker_id TEXT, checker_name TEXT NOT NULL,
     state TEXT NOT NULL, text TEXT, note TEXT, request_id TEXT, verdict_request TEXT, created_at INTEGER NOT NULL, settled_at INTEGER, UNIQUE(item_id, round));
   CREATE INDEX IF NOT EXISTS work_checks_open ON work_checks(state) WHERE state = 'checking';
   CREATE TABLE IF NOT EXISTS work_check_chats(chat_id TEXT PRIMARY KEY, check_id TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS work_levels(kind TEXT NOT NULL, bot_id TEXT NOT NULL, level INTEGER NOT NULL, PRIMARY KEY(kind, bot_id));`,
  tables.GROUP_TABLES,
  tables.GOAL_TABLES,
  tables.WORK_CHECK_COLUMNS,
  tables.WEBHOOK_ACCESS,
  tables.MEMORY_CHECKPOINT_TABLES,
  tables.HISTORY_USAGE_TABLES,
  tables.MCP_CONNECTION_TABLES,
  tables.MCP_SIGN_IN_CARD_TABLES,
  tables.REMOTE_WORKER_TABLES,
  tables.RUN_TRANSCRIPT_TABLES,
  tables.SESSION_GRANT_TABLES,
  tables.HISTORY_PREVIEW_TABLE,
  tables.NOTIFICATION_TABLES,
  tables.MEMORY_CHECKPOINT_REFUSAL_TABLES,
  tables.SHOWN_TABLES
]
