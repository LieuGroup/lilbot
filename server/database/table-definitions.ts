/** Schema step 29, webhooks (#12), kept beside `migrations.ts`, which holds the ordered list of steps. An address is a MAC
 *  of the webhook id and a random nonce, never stored; signing secrets are. An event's `item` (what the bot is shown)
 *  stays until its run settles; its delivery id and signed-body hash stay a week to drop repeats. Every statement is
 *  repeatable, like the steps before it. */
export const WEBHOOK_TABLES = `CREATE TABLE IF NOT EXISTS webhooks(id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), request_id TEXT NOT NULL, description TEXT NOT NULL, source TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, address_nonce TEXT NOT NULL, signing TEXT, paused INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, last_event_at INTEGER, UNIQUE(bot_id, request_id));
   CREATE TABLE IF NOT EXISTS webhook_runs(id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE, bot_id TEXT NOT NULL, created_at INTEGER NOT NULL, events INTEGER NOT NULL DEFAULT 0, started_at INTEGER, finished_at INTEGER, chat_id TEXT, status TEXT NOT NULL DEFAULT 'pending', result TEXT NOT NULL DEFAULT ''); CREATE INDEX IF NOT EXISTS webhook_runs_by_hook ON webhook_runs(webhook_id, created_at);
   CREATE TABLE IF NOT EXISTS webhook_chats(chat_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES webhook_runs(id) ON DELETE CASCADE);
   CREATE TABLE IF NOT EXISTS webhook_events(id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE, delivery_id TEXT, body_hash TEXT, received_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'waiting', run_id TEXT, item TEXT, size INTEGER NOT NULL DEFAULT 0, refusal TEXT, UNIQUE(webhook_id, delivery_id), UNIQUE(webhook_id, body_hash));
   CREATE INDEX IF NOT EXISTS webhook_events_waiting ON webhook_events(webhook_id, received_at) WHERE state = 'waiting'; CREATE INDEX IF NOT EXISTS webhook_events_run ON webhook_events(run_id); CREATE INDEX IF NOT EXISTS webhook_events_time ON webhook_events(received_at);`

/** Schema step 31, temporary groups (#133), kept beside `migrations.ts`. A group is a thread (`threads`); this row beside
 *  it holds the leader's request id (retries find the same group), the conversation its outcome goes to, when it ended
 *  and whether the work after its end (stopping runs, dropping work items, archiving its folder) is done. Repeatable. */
export const GROUP_TABLES = `CREATE TABLE IF NOT EXISTS thread_groups(thread_id TEXT PRIMARY KEY, leader_id TEXT NOT NULL, request_id TEXT NOT NULL, source_chat TEXT NOT NULL,
     created_at INTEGER NOT NULL, ended_at INTEGER, settled INTEGER NOT NULL DEFAULT 0, UNIQUE(leader_id, request_id));
   CREATE INDEX IF NOT EXISTS thread_groups_unsettled ON thread_groups(settled) WHERE settled = 0;`

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

/** Same-bot checks (#142): with no other bot eligible, a fresh hidden session of the owner checks, on the review model when it differs. */
export const WORK_CHECK_COLUMNS = `ALTER TABLE work_checks ADD COLUMN same_bot INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE work_checks ADD COLUMN checker_model TEXT;`

/** What a webhook's runs may do beyond the narrow default (#12 finding 3: Oscar's list of capability groups), and the one
 *  message a run may send its bot, with where its delivery to the bot's main conversation stands. */
export const WEBHOOK_ACCESS = `ALTER TABLE webhooks ADD COLUMN capabilities TEXT NOT NULL DEFAULT '[]';
   ALTER TABLE webhook_runs ADD COLUMN message TEXT;
   ALTER TABLE webhook_runs ADD COLUMN message_state TEXT;`

/** Schema step 35, pre-compress memory checkpoint (#198), kept beside `migrations.ts`. Remembers which conversation
 *  pieces each bot has already reviewed for memory so restarts and deploys do not re-review them. Repeatable. */
export const MEMORY_CHECKPOINT_TABLES = `CREATE TABLE IF NOT EXISTS memory_checkpoint_reviewed(bot_id TEXT NOT NULL, piece_key TEXT NOT NULL, reviewed_at INTEGER NOT NULL, PRIMARY KEY(bot_id, piece_key));
   CREATE INDEX IF NOT EXISTS memory_checkpoint_reviewed_at ON memory_checkpoint_reviewed(reviewed_at);`

/** Per-turn token/cache usage, compaction token sizes, and per-bot main-conversation context (#180).
 *  Every statement is repeatable, like the steps before it. */
export const HISTORY_USAGE_TABLES = `CREATE TABLE IF NOT EXISTS history_turn_usage(id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, session_id TEXT NOT NULL, row_id TEXT, text TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, usage TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS history_turn_usage_pending ON history_turn_usage(bot_id, session_id, at) WHERE row_id IS NULL;
   CREATE UNIQUE INDEX IF NOT EXISTS history_turn_usage_row ON history_turn_usage(bot_id, row_id) WHERE row_id IS NOT NULL;
   CREATE TABLE IF NOT EXISTS history_compactions(id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, session_id TEXT NOT NULL, row_id TEXT, at INTEGER NOT NULL, before_tokens INTEGER, after_tokens INTEGER);
   CREATE INDEX IF NOT EXISTS history_compactions_pending ON history_compactions(bot_id, session_id, at) WHERE row_id IS NULL;
   CREATE UNIQUE INDEX IF NOT EXISTS history_compactions_row ON history_compactions(bot_id, row_id) WHERE row_id IS NOT NULL;
   CREATE TABLE IF NOT EXISTS bot_context(bot_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, used INTEGER NOT NULL, window INTEGER);`

/** Schema step 35, the MCP services bots add (#187). A row is what bots and Oscar may see: never a token, which lives
 *  only in `<data>/mcp-credentials.json`. Removing a service deletes its row. Per-bot switches (#62) can join a table of
 *  their own without changing this one. */
export const MCP_CONNECTION_TABLES = `CREATE TABLE IF NOT EXISTS mcp_connections(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, address TEXT NOT NULL, state TEXT NOT NULL,
     added_by TEXT NOT NULL, added_by_name TEXT NOT NULL, request_id TEXT NOT NULL, created_at INTEGER NOT NULL, last_worked_at INTEGER, tools TEXT NOT NULL DEFAULT '[]',
     UNIQUE(added_by, request_id));`

/** Schema step 38, in-chat sign-in cards for MCP services (#216). Stores only the card's public metadata and state:
 *  never the sign-in URL, OAuth `state`, PKCE verifier or pasted callback address. Every statement is repeatable. */
export const MCP_SIGN_IN_CARD_TABLES = `CREATE TABLE IF NOT EXISTS connection_sign_in_cards(id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, bot_id TEXT NOT NULL, chat_id TEXT NOT NULL,
     service_name TEXT NOT NULL, service_address TEXT NOT NULL, provider_domain TEXT NOT NULL, state TEXT NOT NULL, reason TEXT, label TEXT,
     created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, settled_at INTEGER);
   CREATE INDEX IF NOT EXISTS connection_sign_in_cards_waiting ON connection_sign_in_cards(connection_id, state) WHERE state = 'waiting';
   CREATE INDEX IF NOT EXISTS connection_sign_in_cards_bot_chat ON connection_sign_in_cards(bot_id, chat_id, created_at);`
