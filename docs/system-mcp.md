# The note and LilBot's own MCP server

Every bot gets (1) a short "about your system" note and (2) an MCP server, served by LilBot, whose tools operate the
app. Rules and the short version are in `AGENTS.md` under "System". Code: `server/bots/system-note.ts` and
`server/system/`.

## The note

- Written by LilBot, about 200 words: the bot's name, id, folder and model; that it runs in LilBot on the leader; the
  other bots (up to eight, then a count); the computers; the standing rules for choosing a computer (static text
  that adds no online state and no main mark: the per-message origin line and `lilbot_about` give those); whether coding
  through T3 Code works; the running release; and two lines pointing at `lilbot_about` and `lilbot_guide` with the rules
  for changing LilBot.
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

## Tokens per turn (dev bot, `cliproxyapi anthropic/claude-sonnet-5-5`, fresh session, same prompt twice)

| | tokens sent |
|---|---|
| before (main at fa444d0) | 20,168 |
| the 18 tools, no note | 21,000 (+832, about 46 per tool) |
| tools and note | 21,358 to 21,372 (+1,190 to +1,204 in total, about 6%) |
| 24 tools (the delegation six added, #132) and note, `check:system`'s first question | 21,853 (the six are 3.2k characters of tool list, about 480 tokens) |

The note is 867 characters; the tool list is the larger part. Hermes reported an 85% cache hit on the turn. Hermes can
defer MCP tools behind its own `tool_search` bridge (`tools.tool_search`, on when the deferrable tools pass
`threshold_pct` of the context window, 5% by default); at this size the tools stay eager.

## The server

- `POST /engine/lilbot/mcp` on the private listener (`main.ts`, beside the T3 bridge). Streamable HTTP answered as plain
  JSON: `initialize`, `notifications/*`, `ping`, `tools/list`, `tools/call`. Loopback Host only, no `Origin`, never on
  the Access listener or the helper door (their `/engine/*` refusal covers it; `tests/http/access-door.test.ts`).
- One key per bot per purpose: `connectionKey(engineToken, "lilbot-system", botId)`. The server accepts only keys of
  current bots (`store.list()`), so a deleted bot is refused. The T3 bridge's key (purpose `t3-bridge`) is unchanged and
  does not work here. Future bot tools (memory, routines, threads, library, skills, computers: #113) join this server
  with the same key.
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
| `lilbot_bot_create` | `create_bot`: `BotService.createFromBot` (any bot; request-id idempotency; model inherited) |
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

Not offered, by decision: deleting a bot, removing a computer, forgetting another bot's private facts, changing a bot's
permission mode, registering computers. Routines, `ask_bot`/`list_bots`, library, skills, computers and memory writes
stay on the engine plug-ins until #113 moves them.

MCP requests carry no session (checked live: two sessions of one bot send identical requests, `_meta` holds only a
progress token). A tool that needs the calling conversation takes a `requestId` and resolves it from the engine's
`tool.start` reports (`server/threads/calling-chats.ts`).

Judgment calls: a memory tool may name another bot's panel (as Oscar can on the screens), but only a fact in that
panel can be named, by the short id a bot sees; the default is the calling bot's own. Another bot's private facts can
be listed, paused and restored, never forgotten.

## The change log

`system_changes` (the last schema step, `system-changes.ts`) records, per action tool, the time, the calling bot's id and name at
that moment, the tool, the target (bot, fact or section id) and the names of the fields changed, never their values.
Reads and refused calls leave nothing. `lilbot_about` shows the latest eight. Deleting a bot keeps its rows.

## What an engine provides

An MCP client that takes a URL and a bearer token (`McpConnection`), refreshes its tool list when the URL changes, and
applies the instructions it is given as the system prompt. Nothing else: no plug-in is needed for this server. Hermes
specifics (how the connection is applied, what is skipped on restart) are in `docs/hermes-engine.md`.

## Adding a tool

Add it to a `server/system/tool-*.ts` file with `readTool` or `actionTool`, reusing the schema from `shared/` and the
service function the screen calls; add a line to the guide topic it belongs to; add it to the list in
`tests/system/system-mcp.test.ts`. Keep the description to one sentence: every tool costs tokens in every turn.
