/** Schema step 31, temporary groups (#133), kept beside `migrations.ts`. A group is a thread (`threads`); this row beside
 *  it holds the leader's request id (retries find the same group), the conversation its outcome goes to, when it ended
 *  and whether the work after its end (stopping runs, dropping work items, archiving its folder) is done. Repeatable. */
export const GROUP_TABLES = `CREATE TABLE IF NOT EXISTS thread_groups(thread_id TEXT PRIMARY KEY, leader_id TEXT NOT NULL, request_id TEXT NOT NULL, source_chat TEXT NOT NULL,
     created_at INTEGER NOT NULL, ended_at INTEGER, settled INTEGER NOT NULL DEFAULT 0, UNIQUE(leader_id, request_id));
   CREATE INDEX IF NOT EXISTS thread_groups_unsettled ON thread_groups(settled) WHERE settled = 0;`
