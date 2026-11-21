/** Schema step 29, webhooks (#12), kept beside `migrations.ts`, which holds the ordered list of steps. An address is a MAC
 *  of the webhook id and a random nonce, never stored; signing secrets are. An event's `item` (what the bot is shown)
 *  stays until its run settles; its delivery id and signed-body hash stay a week to drop repeats. Every statement is
 *  repeatable, like the steps before it. */
export const WEBHOOK_TABLES = `CREATE TABLE IF NOT EXISTS webhooks(id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), request_id TEXT NOT NULL, description TEXT NOT NULL, source TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, address_nonce TEXT NOT NULL, signing TEXT, paused INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, last_event_at INTEGER, UNIQUE(bot_id, request_id));
   CREATE TABLE IF NOT EXISTS webhook_runs(id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE, bot_id TEXT NOT NULL, created_at INTEGER NOT NULL, events INTEGER NOT NULL DEFAULT 0, started_at INTEGER, finished_at INTEGER, chat_id TEXT, status TEXT NOT NULL DEFAULT 'pending', result TEXT NOT NULL DEFAULT ''); CREATE INDEX IF NOT EXISTS webhook_runs_by_hook ON webhook_runs(webhook_id, created_at);
   CREATE TABLE IF NOT EXISTS webhook_chats(chat_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES webhook_runs(id) ON DELETE CASCADE);
   CREATE TABLE IF NOT EXISTS webhook_events(id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE, delivery_id TEXT, body_hash TEXT, received_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'waiting', run_id TEXT, item TEXT, size INTEGER NOT NULL DEFAULT 0, refusal TEXT, UNIQUE(webhook_id, delivery_id), UNIQUE(webhook_id, body_hash));
   CREATE INDEX IF NOT EXISTS webhook_events_waiting ON webhook_events(webhook_id, received_at) WHERE state = 'waiting'; CREATE INDEX IF NOT EXISTS webhook_events_run ON webhook_events(run_id); CREATE INDEX IF NOT EXISTS webhook_events_time ON webhook_events(received_at);`

/** What a webhook's runs may do beyond the narrow default (#12 finding 3: Oscar's list of capability groups), and the one
 *  message a run may send its bot, with where its delivery to the bot's main conversation stands. */
export const WEBHOOK_ACCESS = `ALTER TABLE webhooks ADD COLUMN capabilities TEXT NOT NULL DEFAULT '[]';
   ALTER TABLE webhook_runs ADD COLUMN message TEXT;
   ALTER TABLE webhook_runs ADD COLUMN message_state TEXT;`
