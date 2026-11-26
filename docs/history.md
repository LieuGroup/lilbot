# Conversation history

`server/history/` owns the conversation record (`shared/history-schema.ts`); Hermes owns the model's working context and
LilBot never summarises. The short version is in `AGENTS.md` under "Conversation history".

## Journalling and background import

- Streaming chat events are journalled before forwarding; when no browser is open, observer replay is journalled by
  epoch and sequence (user sends, tool rows, completion). A read-only background importer reconciles Hermes
  transcripts, including work done while LilBot was offline. Row ids are namespaced by engine and profile, and repeated
  pages upsert; tool results are keyed by their persisted tool call id. It is an append-only record: rewinds and resets
  never erase copied rows. Migration 19 rewinds import checkpoints once to backfill tool lines into existing copies,
  keeping every stored row.
- The importer does one 100-row page per bot per second with atomic row/cursor checkpoints; discovery runs every 30
  seconds; startup never waits for history. Errors leave the import pending for retry; it is safe to resume and repeat.
- `bun run history:exclude -- --bot <id> --session <id> --reason "<text>" [--yes]` (operator only) permanently removes
  one engine session from LilBot's copy and keeps importers, journal and replay from restoring it (Hermes untouched;
  the main session is refused). It previews without `--yes` and reads `LILBOT_DATA_DIR`.
- `bun live-checks/history-benchmark.ts` uses a synthetic 5,000-row dev copy, never production data.

## Which sessions are the conversation

- LilBot records only the bot's own conversation (`history/history-owned.ts`, migration 46): sessions it opened as the
  bot's main conversation (new, resumed or after an engine switch), the sessions the bot already had before LilBot first
  listed it (its one-time import of earlier history; a session with no start time is never adopted), and their
  compression continuations. A session started anywhere else, such as a chat held in the engine's own apps, is never
  imported, journalled, searched, shown as activity or unread, or reviewed for memory (`ChatKind` `outside`), whatever
  the engine lists. Sessions already in a copy at the upgrade are kept; an excluded session is never the conversation.

## Where each item sits

- An item sits where Oscar first saw it (`history/history-sent.ts`). The engine keeps everything in the order it
  happened except a message sent while the bot was busy (a hidden turn, a reply still running), which it writes when it
  starts on it. So an imported message moves up past exactly the rows LilBot first showed after he sent it, decided by
  the journal's event order alone: a reply's first words, a tool's start, a placed message's send. No time from the
  engine's clock is compared with the journal's, so no clock difference or coincidence changes the order; LilBot's own
  rows (shown files, sign-in cards, thread and work lines) carry LilBot's time like the send. A reply whose turn end is
  not yet journalled counts as the open turn's only when it begins with every word that turn has journalled since its last start or tool. Every lookup is an index seek (migration 46 indexes the journal by event
  type, by a finished turn's row, by a sent message's text and by a tool's id), and a message passes at most 500 rows, so
  placing does not grow with the history. Opening a chat reads the newest engine page (since #87: the importer pages
  oldest first, so this is how a reopened chat shows what happened while LilBot was not
  watching); a row already stored is neither placed again nor rewritten unless its item changed. The web and phone apps put a message into the conversation the moment it is sent, marked as
  waiting until the engine starts on it; the engine's echo of it adds nothing.
- Known limits, both the same as before this rule:
  - A row an earlier release already stored in the wrong place (a message sent while busy, stored below the reply that
    showed after it) stays there. Stored rows are never moved, and nothing kept for them shows what really happened.
  - When LilBot was not running while a hidden reply's first words showed, or missed that turn's end and a later turn has
    already started, the journal has nothing to compare, so the message keeps the engine's place below that reply.

## Hidden sessions and compression lineage

- Attachment metadata and thread references are merged at the HTTP edge; a thread's private transcript is never
  indexed. Routine and webhook runs and hidden thread and review sessions are excluded, and so is a session the engine
  continued one of them in after compressing: Hermes writes that child without the hidden mark, so
  `bots/hidden-chats.ts` follows `BotEngine.compressionRoot` (read-only, from the profile's session metadata, roots
  remembered) and the overflow catalogue drops a lineage with any hidden or tool session in it.
- The same check keeps those sessions out of activity observation and both memory reviews. When the lineage cannot be
  read the session counts as hidden (it fails closed, logged once a minute as `[session-lineage]`) and is asked about
  again next time.

## Snapshots, paging, dividers and search

- `chat.open`/`chat.new` keep their snapshot shape: `items` holds the latest 100 records without session dividers (for
  old clients); additive `history` holds the page (`shared/history-schema.ts`). The active session id remains
  `snapshot.chatId`; a new session keeps earlier history.
- A session divider (`session:<id>`) marks where a session began. Pages (`HistoryStore.page`) leave out the divider of
  a session with no user or assistant message, unless it is the bot's main session (just after New session). The rule
  is applied when a page is built, so stored dividers (older ones included) and re-imported rows follow it, and nothing
  is deleted: another client's empty session in the same profile, or a session left before anything was said, shows no
  line. A session LilBot started because the engine could not resume the conversation carries `reason: not_resumed`,
  and the screen says so.
- `chat.history` pages are newest first, records within a page chronological. Cursors are bot-bound sort keys, so new
  messages do not shift old pages. `start` appears only on the oldest page after import completes; `null` is not a
  definitive beginning while import is pending. `history.changed {botId}` tells clients to refresh.
- `lilbot_history_search(query, limit?)` on LilBot's System MCP server calls `HistoryService.search` to search only the calling bot's main conversation rows and report import progress (the retired `/engine/history/search` plug-in route answers HTTP 410). Hidden sessions (routines, webhooks, exchanges, reviews, checks) and their compression continuations stay excluded, failing closed when lineage cannot be read.

## Per-turn usage, context and compaction markers (#180)

- `turn.finished` and stored `assistant` history items carry additive `usage` (`TurnUsage`: `inputTokens`,
  `cacheReadTokens`, `cacheWriteTokens`, `outputTokens`, `contextTokens`, `contextWindow`; counts only, no prices,
  omitted when the engine reports nothing), persisted in `history_turn_usage` and merged on import/re-import.
- `Bot.context` (`{ used, window }`) tracks the main conversation's current occupancy against its model's window in
  `bot_context`, surfaced on `bots.list`, `bots.get` and `ChatSnapshot.context` with no extra on-demand engine round
  trips.
- Declared engine compaction rows (`row_kind: 'compaction'`) store as `compaction` items (`author: 'system'`) with
  `compactedMessages`, `summary`, and `beforeTokens`/`afterTokens` (from live compaction counts in `history_compactions`
  or shrinking neighbor turns).

## Memory save before compression (#148)

- Before Hermes shortens a conversation, LilBot reviews every user and assistant word of it for memory (Hermes'
  pre-compress checkpoint v2, `/engine/history/save`). `memory/memory-checkpoint.ts` cuts it into passes of about
  100,000 characters on message boundaries, oldest first, three at a time, each a hidden memory-only review of the same
  bot on `LILBOT_REVIEW_MODEL` under the normal memory rules, and answers only once every pass finished. Reviewed pieces
  are remembered per bot in SQLite (bounded, pruned oldest first, cleared on bot deletion), so a retry, restart or the
  next shortening reviews only what is new, and a second save of the same conversation waits for the first. LilBot's own
  sessions, their continuations and review sessions answer `skipped` (complete, nothing reviewed); an unreadable lineage
  is refused, never skipped. Webhook notes are taken out of the evidence first (`withoutWebhookNotes`).
- Every bot connected to LilBot memory is fail-closed (`compression.checkpoint_required`, set and cleared with the
  memory connection, Oscar's decision on #148): both of Hermes' compaction paths, its own and the gateway's hygiene
  pre-pass, take the save or do not shorten. A compaction asked for from outside a turn (`session.mutate` compress) is
  always refused then (#167). Start-up sets the flag again once when something outside LilBot changed the profile (the
  deploy watchdog clears it for a rollback, see [deploy.md](deploy.md)); an unchanged restart writes nothing, since a
  changed flag rebuilds every cached Hermes agent of the bot.
- A save that finds LilBot gone (connection refused or cut off before an answer, as during a deploy's restart) is sent
  again every 3 seconds for up to 90 seconds, so a restart only pauses the turn; a save that timed out while running
  is never sent again.
- When the save cannot finish (LilBot down longer, a review failing), the turn that needed the compaction stops (the
  model does not run) and LilBot shows one line in its own words instead of Hermes' text: "<bot> couldn't save its
  memory before shortening this long conversation, so it stopped instead of forgetting anything. Send your message
  again in a moment." (`web/src/chat/failure-lines.ts`). LilBot knows it from the adapter's own record of its saves
  (`lilbot-memory-saves.jsonl` in the profile: session, time, finished or not; never text): a turn that failed, live or
  replayed, or a stored row that closes a failed turn (`display_kind` `failed_turn`), while its session's latest save
  had failed becomes `turn.finished` with `failure: memory_save` or an `error` item with `reason: memory_save`
  (`engines/hermes/hermes-memory-saves.ts`). The next turn answers once (Hermes has no fresh token count after a failed
  turn, so it skips compaction), then every turn stops the same way until the save can run. The session is kept and
  nothing is reset; once LilBot is back the message sent again is answered and the conversation shortens with the
  save. Measured in `check:checkpoint`.
- **Repeated refusal splitting & owner choice (migration 44):** if the review model refuses a piece (`review_refused`
  from `content_policy_blocked`; `provider_policy_blocked` is an account data-policy error and fails as `review_failed`), LilBot retries it once on the bot's own conversation
  model. Transient failures never count as refusals. If both models refuse a multi-message pass, LilBot binary-splits
  it along message boundaries (`MAX_SPLIT_DEPTH = 6`, `MAX_EXTRA_SPLIT_PASSES = 12` extra sub-passes / at most 24 extra
  model calls per refused pass) and saves every non-refused message and every other pass immediately so only the
  smallest refused unit (ideally one message) remains unsaved. Only after both models refuse that narrowed unit twice
  (tracked by SHA-256 key and approximate non-text timing in `memory_checkpoint_refusals`, never text) does an eligible
  owner main conversation show a card (`memory.checkpointPending` / `memory.checkpointChoose`) offering **Compact &
  continue** (`skip_piece`, marking only that unit reviewed and automatically resuming a clean stopped turn) or **Start
  a new session** (`new_session`, skipping nothing). Every choice is audited in `system_changes`
  (`memory_checkpoint_choice`, key only), and limited or hidden sessions never get to choose.
