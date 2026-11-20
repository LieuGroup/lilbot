/** Schema step 32, goals (#143), kept beside `migrations.ts` like the webhook tables. A goal keeps its agreement, target and
 *  rhythm as JSON, the review routine LilBot made for it (`routine_seq` numbers each one it made, for its request id) and a
 *  change the bot proposed. Its events and reviews are never deleted; work items point at their goal. */
export const GOAL_TABLES = `CREATE TABLE IF NOT EXISTS goals(id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, bot_name TEXT NOT NULL, request_id TEXT NOT NULL, text TEXT NOT NULL, state TEXT NOT NULL,
     agreement TEXT NOT NULL, target TEXT NOT NULL, review TEXT NOT NULL, proposal TEXT, oscar TEXT, routine_id TEXT, routine_seq INTEGER NOT NULL DEFAULT 0, drop_reason TEXT,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, agreed_at INTEGER, finished_at INTEGER, UNIQUE(bot_id, request_id));
   CREATE INDEX IF NOT EXISTS goals_by_bot ON goals(bot_id, state);
   CREATE TABLE IF NOT EXISTS goal_events(id INTEGER PRIMARY KEY AUTOINCREMENT, goal_id TEXT NOT NULL, at INTEGER NOT NULL, by_kind TEXT NOT NULL, kind TEXT NOT NULL, text TEXT, request_id TEXT);
   CREATE INDEX IF NOT EXISTS goal_events_goal ON goal_events(goal_id, id);
   CREATE TABLE IF NOT EXISTS goal_reviews(id INTEGER PRIMARY KEY AUTOINCREMENT, goal_id TEXT NOT NULL, request_id TEXT NOT NULL, item_id TEXT NOT NULL, at INTEGER NOT NULL, value REAL NOT NULL, previous REAL NOT NULL,
     moved TEXT NOT NULL, met INTEGER NOT NULL, stalled INTEGER NOT NULL, did TEXT NOT NULL, work TEXT NOT NULL, UNIQUE(goal_id, request_id));
   ALTER TABLE work_items ADD COLUMN goal_id TEXT;
   CREATE INDEX IF NOT EXISTS work_items_goal ON work_items(goal_id) WHERE goal_id IS NOT NULL;`
