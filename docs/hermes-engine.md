# Hermes engine notes

How `server/engines/hermes/` maps LilBot onto Hermes. Read this before changing the Hermes engine. The rules that
apply everywhere (never fork or patch Hermes, read only declared contract fields, the contract test) are in
`AGENTS.md` under "Hermes".

## Connections

- Each bot has a profile binding; a chat is a Hermes session. LilBot supplies instructions, model and permission mode
  and repairs drift before use; it never writes a display name to the profile.
- Bot management uses one shared gateway connection on the default profile. Each open chat has its own connection for
  its bot's profile, because Hermes binds sessions to the profile the connection was attached with (another profile's
  session is refused with `profile_mismatch`).
- Sessions use Hermes' canonical methods (`x-canonical-methods` in the contract); profiles and models use the general
  `methods` table.
- Each connection starts with a single-use ticket from `hermes gateway attach --json` (about one second, the slowest
  step in opening a chat). After a chat opens, `hermes-spare-sockets.ts` attaches one spare connection for that
  profile in the background; the bot's next open takes it (about 0.15-0.4 s instead of 1.1-1.8 s). A spare holds no
  session. At most four profiles keep one, each for ten idle minutes; deleting a bot closes its spare.

## Start-up preparation

- Per profile the steps are permissions, the computers plug-in, the skills plug-in and the MCP connection. Each costs
  `hermes` CLI spawns and plug-in admissions (about 20 s per bot when everything is applied), so a start applies only
  what changed. Bots are prepared independently: the primary first, the rest five at a time (`bots/runtime-readiness.ts`).
- `hermes-applied.ts` keeps `lilbot-applied.json` in the profile folder: a hash per step of what it applied (adapter
  code, settings, connections) plus the hash of the profile's `config.yaml` at the end of the last LilBot change. A step
  is skipped only when its hash matches and `config.yaml` is byte-for-byte unchanged, so an outside edit applies
  everything again. Every LilBot write to `config.yaml` (memory setup, identity) runs through `applied()` so the record
  stays valid, and steps of one profile take turns. A kill in the middle of a change leaves the record stale and the
  next start repeats the steps. Permissions are not recorded: `approvals.mode` is checked on every start and chat.
- Plug-in changes (`hermes-plugins.ts`) take turns across bots: Hermes admits them under one install lock that looks
  at every profile, and answers 5026 "plugin configuration changed while preparing publication; retry" when any
  profile's plug-in configuration changed meanwhile (another LilBot process on the same Hermes home does this too).
  A refused change is repeated up to three times. Enabling uses one `plugins.manage` toggle on; only when the plug-in
  was already enabled does it toggle off and on again, to make the gateway load newly copied code. `config set` calls
  and attaches stay parallel across profiles.
- A profile with no record (first start after this shipped, or a new profile) runs every step once.
  `live-checks/startup-latency-check.ts` keeps its 90 s bound for five fresh, never-prepared bots.

## Model and reasoning effort

The wire is Hermes' canonical `session.create` (`reasoning`) and `session.mutate` (operations `model` with payload
`{model, provider, reasoning?}` and `reasoning` with `{effort}`, null returning to the profile's level); every method and
field LilBot uses is in `tests/engines/hermes/hermes-contract.test.ts`. A profile cannot hold an effort
(`profiles.configure` has no field for it), so LilBot keeps it and sends it per session.

- `hermes-session-settings.ts` (`BotEngine.updateSession`) opens its own short connection, resumes the main
  conversation for its revision and generation, mutates, and reads the session's `reasoning_effort_wire` back. It makes
  no change when the conversation no longer exists, and retries a `revision_conflict` once from a fresh read.
  A model with a level is one committed step; a model with the default level is two (the reset needs the new
  generation), read again between them. Hermes reports the level it sends as an empty string for none.
- Observed live on the dev gateway: `session.mutate` works from a second connection while the chat's own is open;
  a model pick during a turn answers `status: deferred` and Hermes applies it when the turn ends (the chat's connection
  then gets a `session.info` event carrying the new level, which is how `effectiveReasoningEffort` follows); the next turn is
  answered by the new model and keeps the conversation. Its first reply has no prompt cache (0% cache hits, then 50%).
- A level is passed through unchanged on the dev provider for every model tried (all seven reported as sent); `none` is sent as no level.
- Hermes' selection guards run on a model pick (cost, data policy, and a conversation of at least
  `model.switch_context_confirm_tokens`, default 100,000). A flagged pick is refused with a reply that has no `revision`,
  nothing written, and a `confirm` token (not declared in the contract); LilBot reads the missing `revision` as the refusal and
  answers `confirm_required`. A pick under the threshold to a smaller window is accepted, and the next turn compacts
  first ("Pre-API compression", summarised by the auxiliary model), which runs the memory plug-in's `on_pre_compress`
  (the review of the conversation) on the bot's new model.
- A session that is resumed keeps the model and effort it has (thread follow-ups, routine answers); only new sessions
  take the bot's current ones.

## Permissions

Full access is the persistent per-profile `approvals.mode: off`, so background runs inherit it. Chat and review
checks reuse their profile-bound sockets; list/get reads never prepare permissions.

## Activity observer

One persistent observer socket per bound bot, polled in parallel once per second, reconnecting with capped
exponential backoff. It reads visible live sessions and incremental replay events without resuming them; an epoch
change or truncated replay gets one full baseline read. Derived session state survives sweeps; removed profiles
release their sockets. It connects with native profile ids and emits activity and replay cursors with LilBot ids.
Missing profiles and an unavailable engine are not observed.

## Deletion

Hermes has no delete RPC: its profile-delete CLI stops the runtime and deletes its transcripts. A retry after the
folder is gone uses `profile purge-identity` to finish gateway identity settlement.

## Memory adapter (`memory-adapter/`)

- A memory provider plug-in, Python standard library only, holding no data. It puts the usage rules in the system
  prompt (static, so prompt caching holds) and supplies the memory block once per turn. Hermes itself fences what a
  provider supplies as "recalled memory, not new user input".
- Connecting a bot (`hermes-memory-setup.ts`) copies the plug-in into the profile, selects it, and switches Hermes'
  own `MEMORY.md`/`USER.md` memory off. Hermes' notes about the user become shared facts; an existing bot's own notes
  become its private facts (a new bot starts as a copy of the main bot, so its notes are not imported). It takes
  effect from the bot's next session. `removeMemory` undoes it.
- Hermes keeps a plug-in's code loaded per folder until the gateway restarts, so each version has its own folder and
  provider name (`lilbot-memory-v0-10-0`), loaded fresh on the bot's next session. Hermes' own background memory review
  runs only with its built-in memory tool, which a connected bot no longer has.
- `sync_turn` hands every finished turn of a real conversation to `/engine/memory/turn` on a thread (not scheduled
  runs or sub-agents).
- `on_pre_compress` is Hermes' best-effort hook, not the v2 fail-closed checkpoint promise: an unavailable server or a
  failed review logs a warning and Hermes may proceed.

## History import

- First open reads only the latest engine page and resumes with `omit_messages`.
- Tool results are keyed by their persisted `tool_call_id`: Hermes projects them without `row_id`.
- Both session catalogue APIs cap at 200 without pagination. At that boundary the adapter reads only session metadata
  from that profile's `state.db`, in read-only mode, joining compression parents; all message content still goes
  through `session.transcript`. This depends on Hermes' session table schema and has a fixture test.
- Hermes limits a transcript row to 2 MiB and may rotate very old compression lineages.

## Attachments

Image bytes are staged with canonical `image.attach_bytes`, then the declared `{path,mime}` goes to
`prompt.submit.attachments`. The installed implementation only admits images from its profile cache there, so
non-images are supplied as JSON-quoted workspace references in `api_text`, which also keeps the display marker out of
model input. `model.options` declares `ModelCapabilities` with fast/reasoning flags and no vision field, so image
support is reported as `unknown`. Hermes declares incoming `CanonicalAttachment` paths but no outgoing attachment
manifest on `MessageCompletePayload` or `TranscriptMessage`.

## T3 Code connection (`hermes-connections.ts`)

- The connection is the profile MCP server `lilbot_t3`, managed with `mcp.servers.list/remove/add` and `reload.mcp`
  only when it changed; other servers in the profile are untouched. The per-bot bridge key lives in the profile's
  `.env`.
- Hermes keeps a server's tool list until its settings change, so the URL carries the sign-in state
  (`?signin=<issued-at|signed-out>`). When a sign-in appears, expires or is revoked, the server notices within five
  seconds and re-prepares every bot (remove, `reload.mcp`, add, `reload.mcp`).
- If an unrelated inherited server fails that reload, preparation succeeds only when `mcp.servers.status` confirms
  every requested LilBot connection is connected.

## LilBot system connection (`lilbot_system`)

- A second profile MCP server beside `lilbot_t3`, applied by the same `prepareConnections`; both are hashed together into
  the `connections` step of `lilbot-applied.json`, so adding the connection runs the step once per profile and an
  unchanged restart skips it. Its URL carries `?tools=<hash of the tool definitions>` (see `docs/system-mcp.md`).
- Hermes does not show an MCP server's `instructions` to the model. The "about your system" note therefore travels in the
  profile's `soul` (the instructions LilBot applies): `applyIdentity` compares and writes `soul` as before, now with
  `withNote(instructions, note)`, and a profile import strips it again.
- Tool Search (`tools.tool_search`) is already on: every MCP tool is deferred behind `tool_search`/`tool_describe`/`tool_call`
  and the model sees a listing line per tool (numbers: "Tokens per turn" in [system-mcp.md](system-mcp.md)). A call can
  arrive wrapped as `tool_call({ name, arguments })`.

## Skills plug-in (`skills-adapter/`)

- Separate from the memory adapter. It overrides the three skill tools to read LilBot's catalogue and route writes to
  `/engine/skills/*`.
- `.bundled_manifest` identifies shipped skills, which stay with Hermes. Hermes searches profile-local skills before
  external/create directories, so LilBot suppresses the stale user entries in Hermes' manifest and supplies its own
  catalogue. `skills.create_dir` and `skills.external_dirs` point to the library.
- With the engine's "Include this engine's skills" switch off, `skills.disabled` also lists the manifest's names, except
  `hermes-agent` (Hermes' `ESSENTIAL_SKILLS` cannot be disabled; `ALWAYS_ON_SKILLS` in `hermes-skills.ts` mirrors it, and
  `check:skills` confirms it stays offered). The apply fingerprint is unchanged while the switch is on, so a release that
  adds the switch does not touch existing profiles.

## Routines

Each run gets its own hidden `yolo` session in the bot's folder. Hermes' `cron.manage` was rejected: mirroring
schedules would add a second source of truth and tie recovery to an engine.

## Delegation control (`hermes-run-control.ts`, `hermes-tool-calls.ts`)

- `stopRun` and `steerRun` open a fresh socket, `session.resume` the hidden session (`omit_messages`) for its live id and
  `execution_generation`, then call `session.interrupt` or `session.steer`; a stale generation is looked up once more.
  Idle sessions answer "not running". Findings: [docs/threads.md](threads.md#engine-findings-dev-gateway-2026-11-20).
- `onToolCall` reports every `tool.start` (name and declared `args`) seen on LilBot's own sockets: open chats, the
  routine runner's socket (the only place a hidden session's events appear) and the activity observer's replay.

## Computers plug-in (`computers-adapter/`, `lilbot-computers-v1`)

Independent of the memory adapter. `computer_exec` calls Hermes' own `detect_hardline_command` before submitting.
