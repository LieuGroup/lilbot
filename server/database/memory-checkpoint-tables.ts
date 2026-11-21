/** Schema step 35, pre-compress memory checkpoint (#198), kept beside `migrations.ts`. Remembers which conversation
 *  pieces each bot has already reviewed for memory so restarts and deploys do not re-review them. Repeatable. */
export const MEMORY_CHECKPOINT_TABLES = `CREATE TABLE IF NOT EXISTS memory_checkpoint_reviewed(bot_id TEXT NOT NULL, piece_key TEXT NOT NULL, reviewed_at INTEGER NOT NULL, PRIMARY KEY(bot_id, piece_key));
   CREATE INDEX IF NOT EXISTS memory_checkpoint_reviewed_at ON memory_checkpoint_reviewed(reviewed_at);`
