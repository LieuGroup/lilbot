# Server architecture, bot deletion and restart recovery

Core rules and the project map are in `AGENTS.md`. This file holds the detailed server mechanics for `server/bots/`,
`server/activity/`, `server/database/`, bot deletion and restart recovery.

## Bot service, runtimes and startup

- `server/bots/bot-service.ts` is what LilBot does with bots, whichever client asks. It joins LilBot's identity
  (`bot-store.ts`), the engine (abilities and chats), the user's preferences (`bot-prefs-store.ts`) and the bot's
  workspace (`workspaces.ts`). Layers, top to bottom: `http/browser-session.ts` (transport) -> `bots/bot-service.ts`
  -> engine and stores. `browser-session.ts` is a typed handler map: a protocol method without a handler does not
  compile.
- `bot-runtimes.ts` resolves the engine binding and applies saved identity. Runtime availability and abilities are
  cached at startup and refreshed on creation, updates, memory connection and observed profile disappearance/return.
  Roster and detail reads use that snapshot and database identities, with `runtimePending` until preparation
  finishes; they never wait for engine calls, profile preparation, memory refresh or the activity observer.
- Start-up preparation (`bots/runtime-readiness.ts`) is one flight per bot: permissions, tools (computers, skills,
  connections), then identity. The server prepares the primary bot first, the rest five at a time after a short
  head start, in the background. A chat, review or routine waits only for its own bot's flight (`BotRuntimes.use`),
  never the roster. A bot whose preparation fails settles as unavailable, never `runtimePending`, and is retried
  after 5 s, 15 s, 45 s, then every two minutes until it is ready or deleted; one bot's failure never stops another's.
  Every settle pushes `bots.changed`. `initialize()` rejects only when the one-time import fails.
- Every start-up pass that touches engine profiles (permissions, memory refresh, skills, connections), and memory
  connection, uses only the non-deleted database bindings, by native id, never all engine profiles. Only the one-time
  import into a new database needs engine discovery. That import is atomic and idempotent: existing bots keep their
  profile ids. New bots get UUIDs independent of their native runtime ids. A missing runtime stays in the roster as
  unavailable; its identity and memory stay in LilBot.
- Identity is imported once, then LilBot wins on mismatch. Model edits are checked against the engine's available
  models before anything is saved, also when repairing a bot with an invalid saved model; the protocol names permission
  modes `approval-required`, `auto-accept-edits`, `auto` and `full-access` (only `full-access` is supported now), and
  unsupported permission modes fail before saving. Accepted edits are saved in the database before they are applied to
  the runtime.

## Model and reasoning effort

Code: `server/bots/bot-session-settings.ts`; Hermes specifics in [hermes-engine.md](hermes-engine.md).

- The effort is `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` or unset (the engine's default; `ultra` is
  not offered). It is saved with the bot, one per bot, kept as chosen when the model changes, and an unknown level is
  refused before saving. `models.list` keeps `models` and adds `capabilities` per model (`reasoning`,
  `canDisableReasoning`: null when the engine does not say, so hide "Off" only for false).
- An edit to model or effort is saved, then applied to the bot's main conversation with `session.mutate`
  (`BotEngine.updateSession`), so it takes effect from the next message, also while a turn runs: the running turn
  finishes as it was. Edits to one bot run in order. An effort for a model that does not reason stays saved and is not
  sent.
- Every session LilBot creates for the bot starts with its effort: chats, routine runs and bot threads (a session that
  is resumed keeps its own). The memory review keeps its own model and gets none.
- `effectiveReasoningEffort` on the bot is what the engine says it sends for the main conversation (null: none). It is
  kept in memory from the session when a chat opens, after an edit and from `session.info` events, never read on demand,
  and absent until the engine has reported it. Null cannot tell "off" from the engine's default (both are sent as no
  level): read it with `reasoningEffort`.
- The engine can hold a conversation's switch back (a conversation of 100,000+ tokens, an expensive model, a data
  policy) until its own confirmation: `bots.update` then answers `confirm_required` after saving (the same edit's
  effort still applies), the choice stays saved for new conversations and the conversation keeps its model. That
  refusal is not retried by later edits. The engine's confirmation token comes back only in undeclared fields of
  `session.mutate`'s result (checked live, #79), so LilBot never confirms; picking the model does not override the
  guard. The first message after a switch has no prompt cache.

## Storage, workspaces, pushes, activity and timers

- `server/database/migrations.ts` owns the schema as an ordered list of migration steps (`database.ts` opens the file
  and applies them): add a step, never edit a shipped one. Each store file owns the SQL of its tables. Default file
  `~/.local/share/lilbot/lilbot.db` (`LILBOT_DATA_DIR`). SQLite connections wait up to five seconds for short locks.
- Workspaces: `~/lilbot/workspaces/<bot id>` (`LILBOT_WORKSPACES_DIR`), created on first use and passed to the engine
  as the working directory of new chats. A resumed chat keeps the folder it was made with.
- Pushes: `bots.changed` goes to every browser when a bot, preference or section changes, or the engine reports that
  sessions or skills changed; browsers fetch the list again. Each feature has its own `<feature>.changed` push.
- Activity (`server/activity/`): live per-session status and durable per-bot unread, in `bots.list` and pushed with
  `bots.changed`. Opening a chat marks its bot read, and any connected viewer keeps it read until the chat closes.
  Finished/failed settles after eight seconds. Replay cursors stop old replies becoming unread again after a restart.
  Unread turns on for a reply, for a session that starts waiting for Oscar and for one that fails, with or without text,
  unless he is viewing; an engine repeating the same waiting/failed status with a later event does not turn it on again
  (`ActivityService.needsOscar`). Hidden memory reviews are excluded. `LILBOT_BOT_IDS` restricts the engine to a
  native-profile allowlist; runtimes created on that server join it.
- Background timers (`background.ts`) catch failures and retry on later ticks; their logs carry fixed task labels, never
  exception payloads. A persistent database failure logs and leaves work pending rather than stopping the server.

## Deleting a bot

`bots.delete` takes optional `files: archive | delete` and `privateMemories: forget | keep`; defaults (archive, forget)
are kept with `bots.deleteDefaults.get/set`. The primary bot and the engine's default bot cannot be deleted.

- `bot-deletion.ts` saves a tombstone with the name and choices before teardown, removes the runtime through its
  native binding, then the workspace, memory, preferences, activity and queued reviews. Retrying the same id finishes
  incomplete cleanup with the original choices. Deletion clears the creation marker and removes the profile settings
  that hold its capability and memory binding.
- A tombstoned bot's capability is refused at once, even while teardown retries; creation retries cannot revive it;
  late activity and memory calls are ignored or refused; uploads, attachment reads and library access stop at once.
  Tombstones stay out of the roster.
- Removed: conversation record and journal (whatever the choices), routines and webhooks with their run history (a
  tombstoned bot cannot dispatch, and its webhook addresses answer 404 at once), skill off switches; its active
  computer requests are cancelled.
- Files: archived to `<workspaces>/.archive/<bot id>` without following links, or deleted; attachments follow the same
  choice.
- Kept: shared facts; private facts unless forgotten (`memory.list` still shows a tombstone's facts for attribution
  and restoration); library and attachment metadata (the bot loses access); thread records with the names captured
  at creation; work items and goals with the owner's name (unfinished ones are dropped: "The bot was deleted."); skills
  it wrote, with their authorship; the log of changes bots made through the system server (with the name the bot had);
  MCP services it added (every bot has them; once it is gone any bot may remove one).

## Restart recovery

Restarting LilBot only leaves Hermes turns and T3 tasks running; nothing is resubmitted.

- The browser reconnects and opens the persisted main conversation. Hermes says whether the turn still runs; LilBot
  reconciles the durable transcript, including tool work and the final answer.
- A new main session starts only when Oscar asks for one or the engine truly cannot resume the conversation: a "not
  found" is asked again on a newly attached connection, and only a second refusal starts one, logged as `[chat]
  conversation could not be resumed` with the engine's code and shown on its divider. A deploy-like restart (past the
  gateway's 20-second grace), a tool reconnect and a second device keep the session (`check:restart`).
- Routines and webhook runs recover the same persisted run and admission receipt. Threads recover their outbox and
  return the answer to the original caller session, never a replacement exchange; a steered redirect is checked against
  the recovered transcript, and a stop is applied again. Oscar's answers, drop notices and goal notices still waiting
  are delivered with the same run id; a drop's exchange stop is already saved. A goal's review routine is made, paused
  or removed to match the saved goal on the next goals tick.
- MCP services: the list and tokens are in the data directory. A sign-in in progress lives in memory, so its link
  stops working after a restart and the bot asks for a new one; a change not yet applied to an open conversation, and
  the "connected" turn, are applied when the conversation is next opened instead (its tools come from the profile).
- The T3 bridge reloads its sign-in from the data directory. Stable per-bot request ids let an uncertain launch find
  the original T3 task, and its thread id allows later waits and reads. A bridge call in flight during downtime
  fails; the bot retries it after reconnecting.
- This covers a LilBot process restart with data preserved, not a Hermes crash or a machine reboot. An unknown engine
  receipt fails explicitly rather than repeating possibly completed work; engine crashes cannot guarantee exactly-once
  external side effects. Failed deployments are recovered by the deploy watchdog. The self-development skill is not
  installed.
