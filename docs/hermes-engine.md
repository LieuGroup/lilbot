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
  first ("Pre-API compression", summarised by the auxiliary model), which runs the memory plug-in's checkpoint (the
  review of the conversation, on `LILBOT_REVIEW_MODEL`).
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

- A minimal tool-less memory provider plug-in (`v0.16.0`, Python standard library only, holding no data). Before-turn
  memory delivery and after-chat review queueing live in LilBot's engine-neutral conversation layer
  (`server/memory/memory-turn-context.ts`, `server/bots/bot-conversations.ts`); the plug-in implements only
  `on_pre_compress` because Hermes's OpenRPC API has no pre-compress RPC callback.
- Connecting a bot (`hermes-memory-setup.ts`) copies the plug-in into the profile, selects it, and switches Hermes'
  own `MEMORY.md`/`USER.md` memory off. Hermes' notes about the user become shared facts; an existing bot's own notes
  become its private facts (a new bot starts as a copy of the main bot, so its notes are not imported). It takes
  effect from the bot's next session. `removeMemory` undoes it.
- Hermes keeps a plug-in's code loaded per folder until the gateway restarts, so each version has its own folder and
  provider name (`lilbot-memory-v0-11-0`), loaded fresh on the bot's next session. Hermes' own background memory review
  runs only with its built-in memory tool, which a connected bot no longer has.
- The save before compressing is Hermes' pre-compress checkpoint API v2 (`pre_compress_checkpoint_api_version = 2`,
  #148). Hermes hands v2 providers its normalised evidence (user and assistant messages; earlier summaries, tool rows and
  system text left out); the adapter sends all of it to `/engine/history/save` and raises on anything but `saved` or
  `skipped`, so a failure keeps the transcript as it is. Sub-agents and scheduled agent contexts return at once (LilBot
  never reviews them).
- `installMemory` also sets `compression.checkpoint_required: true` (after the provider is selected); `removeMemory`
  sets it false first. With it on, both compaction paths run the checkpoint or refuse: the agent's own (pre-API,
  post-tool, overflow) and the gateway's hygiene pre-pass, whose detached agent then loads the memory provider. It also
  withholds Hermes' lossy side paths (proactive tool-result prune, post-turn micro-compaction, server-side native
  compaction), all off in LilBot's profiles anyway. A flagged profile without a v2 provider can never compact, and the
  `codex_app_server` runtime refuses to start with the flag; LilBot sets neither.
- `session.mutate` `compress` (a compaction asked for from outside a turn, #167) is refused with
  `compression_checkpoint_required` whenever the flag is on, before any provider is asked
  (`gateway/session_mutation_compress.py`); v2 does not change that. Checked live in `check:history`.
- A save that finds LilBot gone (refused or cut off before an answer) is sent again every 3 seconds for 90 seconds, well
  within the 300 seconds or more Hermes waits for a compaction; one that timed out while LilBot was saving is not.
- The adapter appends each save's outcome to `lilbot-memory-saves.jsonl` in the profile (session, time, finished; no text;
  trimmed to its newest 500 lines past 200 KB). `hermes-memory-saves.ts` reads it so a failed turn (`message.complete`
  status `error`, live or replayed) or its stored closing row (`display_kind` `failed_turn`) while the session's latest
  save had failed maps to LilBot's own `memory_save` failure instead of Hermes' text. Hermes' `error_surface` cannot tell
  this failure apart (it is a local runtime error like any other), so the record is what decides.
- As of `v0.16.0`, the memory adapter exposes zero plug-in tools, zero `prefetch`/`sync_turn`/`system_prompt_block`
  hooks, and no `rules.md` copy. `lilbot-memory.json` stores only `{ url, bot_id, checkpoint_key }` (a per-bot HMAC
  key scoped exclusively to `POST /engine/history/save`, never the master `engine-token` path). `/engine/history/save`
  temporarily accepts the legacy master-token + capability fallback during the v0.15.0 -> v0.16.0 rollout window so
  already-open sessions can finish compressing without restarting Hermes; that legacy fallback is removed once all
  deployed profiles have rotated past v0.15.0.
- **Adapter-managed `known_plugin_toolsets.acp`:** Because `lilbot-skills-v1` registers tools under `toolset='skills'`,
  Hermes treats `'skills'` as a plugin toolset and auto-enrolls it on any `acp` session unless `known_plugin_toolsets.acp`
  lists `'skills'`. The Hermes adapter owns `'skills'` in `known_plugin_toolsets.acp` (read-merged to preserve any
  existing entries and written through `hermes config set`, never raw-editing `config.yaml`, during `configureSkills`,
  `installMemory`, and as a fast-path check before opening any memory-review session). Limited sessions that request
  `'skills'` (`check`, `webhook`, `narrowed`) keep it; memory reviews (`['context_engine', 'no_mcp']`) receive zero
  skills tools; and rolling back to an earlier release leaves the entry harmless because earlier releases explicitly
  request `'skills'` wherever they expect it.
- The deploy watchdog clears the flag for a rollback and the next start-up of a release with #148 sets it again (see
  `docs/deploy.md`).

## History import

- First open reads only the latest engine page and resumes with `omit_messages`.
- `session.resume` answering `not_found` is asked once more on a newly attached connection (never a spare) before
  `openChat` starts a new session; only the second refusal does, and the chat reports `resumeRefused: hermes_not_found`.
- Other clients open sessions in the same profile: an ACP client on the leader opens an empty `acp` session in the
  default profile about once an hour and closes it after about 2 seconds. Discovery can list one while it is open;
  pages show no divider for it because it never holds a message.
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

## T3 Code connection (`hermes-connections.ts`, only when `LILBOT_T3_ENABLED=1`)

- When `LILBOT_T3_ENABLED=1`, the connection is the profile MCP server `lilbot_t3`, managed with `mcp.servers.list/remove/add` and `reload.mcp`
  only when it changed (with T3 off, `lilbot_t3` is omitted and removed from profiles). LilBot owns the profile's servers named `lilbot_*` and nothing else: one it no longer supplies is
  removed, and any other server (Oscar's `revenuecat` and `paper`) is never changed or removed, even on a name match. The
  per-bot bridge key lives in the profile's `.env`.
- Hermes keeps a server's tool list until its settings change, so the URL carries the sign-in state
  (`?signin=<issued-at|signed-out>`). When a sign-in appears, expires or is revoked, the server notices within five
  seconds and re-prepares every bot (remove, `reload.mcp`, add, `reload.mcp`).
- If an unrelated inherited server fails that reload, preparation succeeds only when `mcp.servers.status` confirms
  every requested LilBot connection is connected.

## MCP services bots add (`lilbot_c_<name>`, #187)

- One profile MCP server per service, named `lilbot_c_<name>`, pointing at LilBot's route
  `/engine/connections/<id>/mcp?v=<sign-in>` with the bot's per-service key in `.env`. The service's address and token
  never reach the profile. `tools.include` is the tool list LilBot read, or `connection_status` alone while signed out.
  These servers are `optional`: when one does not connect, the reload is accepted as long as every required LilBot
  connection (`lilbot_system`, plus `lilbot_t3` when enabled) is connected, so a dead service never makes a bot
  unavailable. Hermes' own `mcp.servers.oauth.*` and
  token store are never used.
- Applying to open chats (`applyToChats`, `BotEngine.applyConnections`): `reload.mcp {confirm, session_id}` for each
  chat, after the profile's preparation, in the same per-profile queue. Measured on the dev gateway (#187 verification,
  Hermes 0.23.1): a live idle chat answers `session: applied` and its next message has the change, at no cache cost (Tool
  Search keeps the model's tool array unchanged); a running turn answers `busy` (LilBot asks again once it ends); a chat
  that is not live gets no `session` and reads the config at its next resume (routine runs and bot threads, which are
  resumed per message). Adding one server reconnects only that server; changing an existing one (a sign-in, an expiry)
  reconnects only it and aborts a call in flight to it, which is why LilBot reconfigures on a timer after the answer.
  Removal reaches an open chat at once. The turn that added a service never sees its tools. `message` in the result is
  human text and is never parsed. `reload.mcp` without `confirm` answers `confirm_required`; `always` is never sent.
- Resuming a chat to apply a change (close and reopen, or `session.resume` on another connection) re-sends the whole
  conversation uncached (about 53,500 tokens on a 52,000-token chat in the verification), so it is never used for this.

## LilBot system connection (`lilbot_system`)

- Profile MCP server applied by the same `prepareConnections` (alongside `lilbot_t3` when `LILBOT_T3_ENABLED=1`); all
  connections are hashed together into
  the `connections` step of `lilbot-applied.json`, so adding or changing a connection runs the step once per profile and an
  unchanged restart skips it. Its URL carries `?tools=<hash of the tool definitions>` (see `docs/system-mcp.md`).
- Hermes does not show an MCP server's `instructions` to the model. The "about your system" note therefore travels in the
  profile's `soul` (the instructions LilBot applies): `applyIdentity` compares and writes `soul` as before, now with
  `withNote(instructions, note)`, and a profile import strips it again.
- Tool Search (`tools.tool_search`) is already on: every MCP tool is deferred behind `tool_search`/`tool_describe`/`tool_call`
  and the model sees a listing line per tool (numbers: "Tokens per turn" in [system-mcp.md](system-mcp.md)). A call can
  arrive wrapped as `tool_call({ name, arguments })`.

## Skills plug-in (`skills-adapter/`)

- Separate from the memory adapter. It overrides the three skill tools to read LilBot's catalogue and route writes to
  `/engine/skills/*`. It stays a plug-in: Hermes' own `skill_manage` writes into the shared library unchecked and cannot be
  removed alone, so the override is what keeps secrets out and records the author (the checks and numbers are in
  [system-mcp.md](system-mcp.md#the-skills-tools-stay-on-the-plug-in-113-third-slice)). Reading would work without it.
- `.bundled_manifest` identifies shipped skills, which stay with Hermes. Hermes searches profile-local skills before
  external/create directories, so LilBot suppresses the stale user entries in Hermes' manifest and supplies its own
  catalogue. `skills.create_dir` and `skills.external_dirs` point to the library.
- With the engine's "Include this engine's skills" switch off, `skills.disabled` also lists the manifest's names, except
  `hermes-agent` (Hermes' `ESSENTIAL_SKILLS` cannot be disabled; `ALWAYS_ON_SKILLS` in `hermes-skills.ts` mirrors it, and
  `check:skills` confirms it stays offered). The apply fingerprint is unchanged while the switch is on, so a release that
  adds the switch does not touch existing profiles.

## Routines

Each run gets its own hidden `yolo` session in the bot's folder. Hermes' `cron.manage` was rejected: mirroring
schedules would add a second source of truth and tie recovery to an engine. Bots schedule through `lilbot_routine`; Hermes'
own `cronjob` tool stays on, so the adapter's system-prompt rules tell the bot to use `lilbot_routine` and never Hermes cron
(`check:routines` names no tool, to prove the bot finds it).

## Delegation control (`hermes-run-control.ts`, `hermes-tool-calls.ts`)

- `stopRun` and `steerRun` open a fresh socket, `session.resume` the hidden session (`omit_messages`) for its live id and
  `execution_generation`, then call `session.interrupt` or `session.steer`; a stale generation is looked up once more.
  Idle sessions answer "not running". Findings: [docs/threads.md](threads.md#engine-findings-dev-gateway-2026-11-20).
- `onToolCall` reports every `tool.start` (`tool_id`, name and declared `args`) seen on LilBot's own sockets: open chats,
  the routine runner's socket (the only place a hidden session's events appear) and the activity observer's replay. The
  replay reports only calls still under way: nothing from a session that is not running on its first read or after a
  reset, and no start whose `tool.complete` is in the same batch (a call LilBot matched was answered before it completed).
  Measured on dev (#174, 60 calls): the start arrived before the MCP request in all but one case, median 4 ms, at most 3.0 s
  before; the latest was 4 ms after.

## Computers plug-in (retired)

The `lilbot-computers-v1` plug-in (`computers-adapter/`) is retired: all eight computer tools now live on LilBot's own
System MCP server (`server/system/tool-computers.ts`) and command safety is enforced in `ComputerService.submit`.
During normal start-up (`HermesEngine.prepareRuntime`), `retireComputersPlugin` removes any leftover
`plugins/lilbot-computers-v1` through Hermes' own `plugins.manage` RPC and deletes `lilbot-computers.json`.
