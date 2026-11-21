# The note and LilBot's own MCP server

Every bot gets (1) a short "about your system" note and (2) an MCP server, served by LilBot, whose tools operate the
app. Rules and the short version are in `AGENTS.md` under "System". Code: `server/bots/system-note.ts` and
`server/system/`.

## The note

- Written by LilBot, about 250 words: the bot's name, id, folder and model; that it runs in LilBot on the leader; the
  other bots (up to eight, then a count); the computers; the standing rules for choosing a computer (static text
  that adds no online state and no main mark: the per-message origin line and `lilbot_about` give those); whether coding
  through T3 Code works; two static lines on when to open a work item (#141); the running release; and two lines
  pointing at `lilbot_about` and `lilbot_guide` with the rules for changing LilBot.
- Delivered through the one engine-neutral system-prompt path: `BotRuntimes.state()` hands every engine
  `withNote(instructions, note)` as the bot's instructions. LilBot's database and the Setup panel keep the user's own
  text; `importBots` strips a note an engine still holds (`withoutNote`).
- Static per session. Each engine builds its prompt once per session, so prompt caching holds; the note is rebuilt on
  every `state()` and applied only when it differs from what the engine holds, so a new session sees current facts
  and a running one keeps its own. Facts that change mid-session (a computer going online, the release after a
  deploy) come from `lilbot_about`, not from the note: keep volatile facts out of it, because any change rewrites the
  instructions of every bot.

### Why not the other two ways (spike, dev Hermes, 2026-11-20)

- **MCP `instructions`:** the server sends them in `initialize`, and Hermes does not show them to the model. Its MCP
  client keeps the handshake result but only reads `.capabilities`; the real system prompt of a dev bot
  (`session.info`) did not contain the server's instructions. They stay in the server for engines that do show them.
- **The memory adapter's per-turn block (`/engine/memory/context`):** Hermes puts it into every user message of the
  turn (stamped into the stored message, so it is repeated in the history) and skips it on trivial prompts, which is
  wrong for a static note and costs tokens every turn. The instructions are the system prompt, built once per session.

## Tokens per turn (dev bot, `cliproxyapi anthropic/claude-sonnet-5-5`, fresh session, same prompt twice, 2026-11-20, main at a9b6d85)

Measured on one temporary bot by removing one part at a time (`contextTokens` of the turn):

| part | tokens sent |
|---|---|
| everything below removed: Hermes, the note, the computers and skills plug-ins | 17,760 to 17,766 |
| + T3 connection, signed out (1 tool) | +48 |
| + the 24 `lilbot_*` tools | +1,084 (about 45 a tool) |
| + memory adapter 0.9.1 (12 tools, rules, memory block) | +2,956 |
| a whole bot, adapter 0.9.1 | 21,854 |
| memory adapter 0.10.0 (10 tools) | +2,593 |
| a whole bot, adapter 0.10.0 | 21,485 |

The note is 867 characters. Hermes reported an 85% cache hit on the turn.

Hermes (0.23.1) defers every MCP tool, and every tool a plug-in registers with `register_tool` (the computers plug-in),
behind `tool_search`, `tool_describe` and `tool_call` whenever one exists: the model sees one listing line per tool
(name and first sentence, about 45 tokens), not its schema, and fetches the schema when it needs the tool. `threshold_pct`
only limits the listing (5% of the context or 4,000 tokens; past that it falls back to names only). Tools a memory
provider returns from `get_tool_schemas` are not in Hermes' registry and stay eager at about 0.43 tokens a character of
compact schema: the adapter's twelve tools cost about 2,300 tokens, the rest of its 2,956 is the rules and the memory
block. The six webhook tools (#12) add six listing lines, about 270 tokens. There is no per-tool switch; `tools.tool_search.enabled: off` makes the whole profile eager, built-ins included.

### Temporary groups' cost (#133)

One listing line (+162 characters, about 40 tokens a turn) and +1,299 characters of full `tools/list`; the note is
unchanged. Measurements in `docs/threads.md`.

### The work board's cost (#141, against main at 3ae7cc0, characters from `systemFixture`)

| | before | after |
|---|---|---|
| listing lines Hermes shows every turn (name and first sentence) | 2,370 (24 tools) | 2,658 (+288: `lilbot_work`, `lilbot_work_list`) |
| the note (minimal facts) | 1,203 | 1,522 (+319: the two work lines) |
| full `tools/list`, fetched only by `tool_describe` or an eager engine | 9,403 | 10,405 (+1,002) |

Per turn that is two listing lines (about 90 tokens at #154's 45 a tool) and about 80 tokens of note. `lilbot_work`'s own
schema is 1,458 characters, read only when a bot looks the tool up. `inputSchema` leaves out `minLength`, `maxLength`,
`minItems`, `maxItems` and `format` (the server parses every call with the same zod schema, so the limits still hold and
a refusal says which): that took about 950 characters off the 24 older tools' schemas, which keeps the full list's growth
to about half the two new tools. A tool's first sentence is all the model sees until it looks the tool up: make it say
what the tool is for.

### Check levels' cost (#142, against main at 9c193f5, characters from `systemFixture`)

| | before | after |
|---|---|---|
| listing lines Hermes shows every turn | 3,284 (32 tools) | 3,290 (+6: `kind, ` in `lilbot_work`'s first sentence; no new tool) |
| the note | unchanged | unchanged |
| full `tools/list` | 12,720 | 13,410 (+690: `lilbot_work`'s `kind` and `verdict`, its longer `level` and description, the `checks` guide topic) |

Per turn that is about 2 tokens. `lilbot_work`'s schema grows from 1,060 to 1,602 characters and its description from 307
to 435, read only when a bot looks the tool up (about 290 tokens more then). A checker's verdict goes through
`lilbot_work` instead of a new tool, which would have added a listing line (about 45 tokens) to every turn of every bot.

### Routines and `create_bot` moved (#113, second slice; before on main at 5067341, after on this branch)

A whole bot, measured directly on a temporary dev bot (memory adapter connected, `cliproxyapi anthropic/claude-sonnet-5-5`,
fresh session, same prompt, `contextTokens`). The absolute level differs from the sum of parts above (that table adds
separate measurements from an older commit); the rows below compare like with like.

| | before | after |
|---|---|---|
| whole bot, tokens a turn | 20,768 | 19,802 (-966, -4.7%) |
| tools Hermes sends in full every turn besides its own and Tool Search | 10 | 4 (`search_conversations`, `recall_memory`, `update_memory`, `give_file`) |
| schema characters of those adapter tools | 4,460 | 2,093 (-2,367: the five routine tools 1,823, `create_bot` 544) |
| `lilbot_*` listing lines (name and first sentence) | 33 | 35 (+2, 225 characters) |

The saving is 2,367 eager characters (about 1,020 tokens at 0.43 a character) against two listing lines (about 90 tokens).
Five routine tools would have been five lines, about 225 tokens a turn; `lilbot_routine` with an `action` field plus
`lilbot_routines_list` is two, about 90. One tool for everything would be 45 more tokens saved but cannot work: a list
inside an action tool is logged as a change in `system_changes` and carries no `readOnlyHint` (`McpTool.readOnly` is one
flag per tool, and the tool-list test pins both). `lilbot_routine`'s schema is 1,631 characters (its `schedule` is the
three-way choice of the screens), read only when a bot looks the tool up. Its first sentence names the four actions and
says it replaces the engine's cron: Hermes' own `cronjob` tool is not deferred, so the MCP tool is found through its
listing line and the adapter's one-line rule. `check:routines` names no tool, and the bot still schedules through
`lilbot_routine` (rows in `system_changes`) for both an Oscar request and its own idea.

### Goals' cost (#143, against main at bb6944a, characters from `systemFixture`)

| | before | after |
|---|---|---|
| listing lines Hermes shows every turn | 3,679 (35 tools) | 3,829 (+150: the `lilbot_goal` line, and "or goals" in `lilbot_work_list`'s) |
| the note | 1,516 | 1,516 (unchanged) |
| full `tools/list` | 16,578 | 20,188 (+3,610: `lilbot_goal`'s schema 2,831 and description 422, `goalId` on `lilbot_work`, `goals` and `goalId` on `lilbot_work_list`, the `goals` guide topic) |

Per turn that is one listing line, about 40 tokens. Goals are read through `lilbot_work_list` (a read tool, so no change-log
row) instead of a second goal tool, which would have added another listing line; proposing, changing and reviewing share
`lilbot_goal`'s `action`. Its schema (two evidence entries and a routine schedule) is read only when a bot looks the tool
up, about 800 tokens then. How to propose and review is the guide topic `goals`, not a skill, whose catalogue line would
cost every turn; the note is unchanged.

### The library's `give_file` moved (#113, third slice; before on main at 58776c6, after on this branch)

Measured as in the second slice (temporary dev bot, memory adapter connected, `cliproxyapi anthropic/claude-sonnet-5-5`, Hermes
0.23.1, fresh session, same prompt, `contextTokens`; three fresh sessions each gave the same number).

| | before | after |
|---|---|---|
| whole bot, tokens a turn | 19,863 | 19,760 (-103, -0.5%) |
| tools Hermes sends in full every turn besides its own and Tool Search | 4 | 3 (`search_conversations`, `recall_memory`, `update_memory`) |
| schema characters of those adapter tools | 2,093 | 1,735 (-358: `give_file`) |
| `lilbot_*` listing lines (name and first sentence) | 36 (3,810 characters) | 37 (3,938 characters, +128) |
| full `tools/list`, fetched only by `tool_describe` or an eager engine | 20,188 | 20,796 (+608) |

358 eager characters at 0.43 tokens a character is about 154 tokens, minus one listing line (about 35 to 45), so about -110;
measured -103. `lilbot_give_file` takes a `requestId` (a new one for each file) because an MCP call carries no session: LilBot
finds the conversation by matching it against the engine's tool starts, as for `lilbot_delegate` and `lilbot_work`. It
is not an idempotency key: a retry gives a second item.

### The skills tools stay on the plug-in (#113, third slice)

Not moved, because it cannot be done without patching Hermes. What was checked, on Hermes 0.23.1 in a scratch
`HERMES_HOME` (Hermes' own tool functions, `skills.external_dirs` and `skills.create_dir` set to a library, no plug-in):

- Reading works natively. `skills_list` and `skill_view` honour `skills.disabled`, a change to it applies in the running process at
  once, and `hermes-agent` stays offered even when listed (`ESSENTIAL_SKILLS`). So the per-bot switches and #140's engine switch
  would keep working for reads with no override.
- Writing does not. Hermes' `skill_manage` writes straight into `skills.create_dir`, which is the shared library: a skill
  holding a password, a key and a zero-width character was created without complaint (`safeText` is bypassed), and
  `SkillsService.list` then records it as written by `oscar` (it adopts any folder it finds), so the author and the secret
  check are gone (`check:skills` asserts the author, `tests/skills/skills.test.ts` the refusal).
- The native tool cannot be taken away alone. `skill_manage`, `skill_view` and `skills_list` share the toolset `skills`
  (`toolsets.py`), and `agent.disabled_toolsets` takes toolset names: dropping `skill_manage` drops `skill_view` too, which is
  the only way to a bundled skill, including `hermes-agent` (Hermes' prompt tells the model to load it with `skill_view`). Hermes'
  own prompt also names `skill_view` and `skill_manage`, so an MCP copy would sit beside them, not instead of them.
- Registering our own versions under the same names is what the plug-in does (`override=True`); only a plug-in can.

So a `lilbot_skills` tool on the MCP server would be a second definition next to Hermes' three, with no token saving (the
override replaces tools that are eager either way) and with the native writer still open. The plug-in stays as it is. An engine
without skill tools of its own would get the MCP tool then, calling the same `SkillsService` as `/engine/skills/*`.

## The server

- `POST /engine/lilbot/mcp` on the private listener (`main.ts`, beside the T3 bridge). Streamable HTTP answered as plain
  JSON: `initialize`, `notifications/*`, `ping`, `tools/list`, `tools/call`. Loopback Host only, no `Origin`, never on
  the Access listener or the helper door (their `/engine/*` refusal covers it; `tests/http/access-door.test.ts`).
- One key per bot per purpose: `connectionKey(engineToken, "lilbot-system", botId)`. The server accepts only keys of
  current bots (`store.list()`), so a deleted bot is refused. The T3 bridge's key (purpose `t3-bridge`) is unchanged and
  does not work here. The bot tools that move off the engine plug-ins (#113: routines, `create_bot`, the library; memory and
  computers still to come) join this server with the same key.
- Arguments are checked by zod schemas built from `shared/`; keys a schema does not name are dropped, so no argument
  can claim another identity. The caller id only ever comes from the key. `inputSchema` is generated from the same
  schemas.
- The connection (`system-connection.ts`) is `lilbot_system`; its URL ends `?tools=<hash of tool names, descriptions and
  schemas>`. Hermes keeps an MCP server's tool list until its settings change, so a release that changes a tool
  reconnects every bot once, and a restart that changes nothing leaves the recorded fingerprint (`lilbot-applied.json`,
  step `connections`) alone. Nothing per-start may enter the URL or the tool text.

## Tools

Every tool acts as the calling bot and calls the function the screen uses. Reads pass `readOnlyHint`.

| Tool | Same as |
|---|---|
| `lilbot_about` | live facts: you, other bots, computers (with which is `main`), T3, release, deploy status and last failure, recent changes |
| `lilbot_guide(topic?)` | text shipped in `server/system/guide/*.md` |
| `lilbot_status(area)` | `connections.status` (t3), `computers.list`, `deploy.status` |
| `lilbot_bots_list`, `lilbot_bot_read` | `bots.list` with `sections.list`, `bots.get` |
| `lilbot_bot_create` | `BotService.createFromBot` (any bot; request-id idempotency; model inherited); the plug-in's `create_bot` ended with adapter 0.11.0 |
| `lilbot_bot_edit` | `bots.update` for name, function, instructions, model, reasoning effort (not the permission mode); bot text gets the creation-time `memoryRefusal` check |
| `lilbot_primary_set` | `bots.setPrimary` |
| `lilbot_models_list` | `models.list` |
| `lilbot_roster_set` | `bots.setPrefs` (pinned, which also sets or clears `pinnedAt`; hidden; section) |
| `lilbot_section_create` | `sections.create` |
| `lilbot_unread_set` | `activity.setUnread` (`bots/bot-unread.ts`, shared with the screen) |
| `lilbot_memory_list`, `_pause`, `_restore` | `memory.list`, `memory.pause`, `memory.restore` |
| `lilbot_memory_expiry` | `MemoryService.setExpiry` (no screen yet; same `memory.changed` push) |
| `lilbot_delete_defaults_get`, `_set` | `bots.deleteDefaults.get` and `.set` |
| `lilbot_delegate` | hand one task to each named bot, with files; one exchange each, one batch (`docs/threads.md`) |
| `lilbot_delegation_status`, `_cancel`, `_redirect`, `_wait` | the delegating bot's control; cancel is the same `ThreadService.cancel` as `threads.cancel` |
| `lilbot_delegation_attach` | the receiver's files for its answer |
| `lilbot_group` | temporary groups (#133): `start`, `say`, `attach`, `close`, `status` in one tool; `GroupService`, the same records as `threads.list`, `threads.open` and `threads.cancel` (`docs/threads.md`) |
| `lilbot_work` | the work board: without itemId opens an item (`WorkService.act`), with itemId reports on the caller's own item: definition, evidence, status in one call; with `verdict`, the check LilBot asked the caller to do |
| `lilbot_work_list` | the caller's items, every bot's, or one in full: the same records as `work.list` and `work.open`; with `goals` or `goalId`, goals (`goals.list`, `goals.open`) |
| `lilbot_goal` | goals (#143): `propose` a goal from Oscar's words in his conversation, a new version or a change (`GoalService.act`); `progress`, a review, saved as a work item through `WorkService.act` |
| `lilbot_routine` | `routines.*` for the caller's own routines: `action` create (`RoutineService.create`; request-id idempotency, five of its own, five-minute minimum), pause, resume or delete (`id`) |
| `lilbot_routines_list` | `routines.list` for the caller: latest five runs each, results cut to 500 characters |
| `lilbot_give_file` | `LibraryService.give`: a finished file from the caller's folder to its Library (`path`, `title`, `requestId`). The conversation and routine run come from the call, not from an argument; each call is a `system_changes` row naming the item. The adapter's `give_file` ended with adapter 0.12.0 |
| `lilbot_webhook_create` | `WebhookService.create` for the caller (five webhooks a bot; the same `requestId` returns the current address and any secret LilBot made again) |
| `lilbot_webhooks_list` | `webhooks.list` for the caller (latest five runs, results cut to 500 characters and fenced as outside data; never addresses or secrets) |
| `lilbot_webhook_pause`, `_resume`, `_delete` | `webhooks.pause`, `.resume`, `.delete`, only the caller's own webhooks |
| `lilbot_webhook_new_address` | `WebhookService.newAddress`: the old address stops working at once |

Not offered, by decision: deleting a bot, removing a computer, forgetting another bot's private facts, changing a bot's
permission mode, registering computers. The deletes a bot has are of its own webhooks (Oscar's decision on #12) and its own routines (it always could: `delete_routine`).
Skills (see below), computers, `search_conversations` and memory writes stay on the engine plug-ins until #113 moves them;
`ask_bot` and `list_bots` ended with adapter 0.10.0 (their work done by `lilbot_delegate` and `lilbot_bots_list`), and
`create_bot` and the five routine tools with adapter 0.11.0 (`lilbot_bot_create`, `lilbot_routine`, `lilbot_routines_list`), and `give_file`
with adapter 0.12.0 (`lilbot_give_file`).

MCP requests carry no session (checked live: two sessions of one bot send identical requests, `_meta` holds only a
progress token). A tool that needs the calling conversation takes a `requestId` and resolves it from the engine's
`tool.start` reports (`server/threads/calling-chats.ts`, which traces `lilbot_delegate`, `lilbot_work`, `lilbot_group`, `lilbot_goal` and `lilbot_give_file`).

Judgment calls: a memory tool may name another bot's panel (as Oscar can on the screens), but only a fact in that
panel can be named, by the short id a bot sees; the default is the calling bot's own. Another bot's private facts can
be listed, paused and restored, never forgotten.

## The change log

`system_changes` (the last schema step, `system-changes.ts`) records, per action tool, the time, the calling bot's id and name at
that moment, the tool, the target (bot, fact or section id) and the names of the fields changed, never their values.
Reads (also a `lilbot_group` status call) and refused calls leave nothing. `lilbot_about` shows the latest eight. Deleting a bot keeps its rows.

## What an engine provides

An MCP client that takes a URL and a bearer token (`McpConnection`), refreshes its tool list when the URL changes, and
applies the instructions it is given as the system prompt. Nothing else: no plug-in is needed for this server. Hermes
specifics (how the connection is applied, what is skipped on restart) are in `docs/hermes-engine.md`.

## Adding a tool

Add it to a `server/system/tool-*.ts` file with `readTool` or `actionTool`, reusing the schema from `shared/` and the
service function the screen calls; add a line to the guide topic it belongs to; add it to the list in
`tests/system/system-mcp.test.ts`. Every tool costs a listing line in every turn: its first sentence must say what it is
for, and the rest stays short. Prefer one tool whose fields cover several steps (as `lilbot_work` does) over a tool per
step, keep `.describe()` for fields whose name does not say enough, and measure the listing and `tools/list` before and
after.
