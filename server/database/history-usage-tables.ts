/** Per-turn token/cache usage, compaction token sizes, and per-bot main-conversation context (#180).
 *  Every statement is repeatable, like the steps before it. */
export const HISTORY_USAGE_TABLES = `CREATE TABLE IF NOT EXISTS history_turn_usage(id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, session_id TEXT NOT NULL, row_id TEXT, text TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, usage TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS history_turn_usage_pending ON history_turn_usage(bot_id, session_id, at) WHERE row_id IS NULL;
   CREATE UNIQUE INDEX IF NOT EXISTS history_turn_usage_row ON history_turn_usage(bot_id, row_id) WHERE row_id IS NOT NULL;
   CREATE TABLE IF NOT EXISTS history_compactions(id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, session_id TEXT NOT NULL, row_id TEXT, at INTEGER NOT NULL, before_tokens INTEGER, after_tokens INTEGER);
   CREATE INDEX IF NOT EXISTS history_compactions_pending ON history_compactions(bot_id, session_id, at) WHERE row_id IS NULL;
   CREATE UNIQUE INDEX IF NOT EXISTS history_compactions_row ON history_compactions(bot_id, row_id) WHERE row_id IS NOT NULL;
   CREATE TABLE IF NOT EXISTS bot_context(bot_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, used INTEGER NOT NULL, window INTEGER);`
