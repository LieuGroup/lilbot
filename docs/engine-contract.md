# Engine contract

What an engine must provide to run LilBot's bots, as a checklist for a second engine. Hermes is the first
(`server/engines/hermes/`, mapping in [hermes-engine.md](hermes-engine.md)); nothing outside an engine's folder knows its
name except `main.ts`, which picks it. The code contract is `BotEngine` in `server/engines/bot-engine.ts`; this page adds
what lives outside that interface.

LilBot owns identity, instructions, memory, skills, routines, history, files and the bot tools. An engine runs a bot's
conversations, reaches LilBot through MCP, and keeps a thin adapter for the few things MCP cannot do.

## 1. Runtimes: one per bot

- [ ] `createRuntime` makes a runtime from a LilBot identity and returns its native id (never shown as a bot id);
  `deleteRuntime` removes it and its conversations, safe to repeat; `importBots` lists existing runtimes for the one-time
  import into a new database (each returned `id` is stored only as `engine_bot_id`; LilBot assigns a fresh random UUID
  as the bot's id).
- [ ] `applyIdentity` applies LilBot's authoritative name-independent settings if they drifted: instructions (the string
  LilBot passes already ends with the system note, section 4), model, reasoning effort and permission mode. A missing
  runtime throws `bot_not_found`. LilBot wins on mismatch.
- [ ] `supportedPermissionModes` includes `full-access`; the bot is applied with it on creation, once at start-up, on
  mode changes, and before chats, reviews and routine runs. No approval cards: an engine must not wait for a person.
- [ ] `validateModel` refuses an unavailable model before anything is saved; `listModels` returns providers, models and
  per-model capabilities (`reasoning`, `canDisableReasoning`, `null` when unknown).
- [ ] Start-up only touches the bindings LilBot passes (native ids); never discover its own set of runtimes.

## 2. Sessions and streaming

- [ ] `openChat(engineBotId, chatId|null, options, onEvent)`: a new session or a stored one; a stored one that no longer exists
  is replaced and the snapshot says which was opened, with `resumeRefused` (the engine's code) when it was replaced. Only
  a definite "does not exist" may replace it, never one connection's refusal. One continuous main conversation per bot,
  one active session.
- [ ] Events (`shared/chat-schema.ts`): `turn.started`, `text.delta`, `activity`, `tool.started` / `tool.finished`,
  `turn.finished` (with `contextTokens`), `user.message`, `title`, `error`, `closed`. Reconnecting or restarting LilBot
  must recover a turn that still runs: the engine says whether it runs and returns the durable transcript.
- [ ] `OpenChat.send(text, { hidden, inputId, apiText, attachments, origin })`: `inputId` makes a retry idempotent;
  `apiText` is what the model sees when it differs from the stored text; `origin.line` is told to the model for this turn
  only, outside the stored text. `stop()` ends the running turn, `close()` releases the socket.
- [ ] A resumed session keeps the model and effort it has. `updateSession` applies a model or effort edit from the next
  message, also while a turn runs, and answers `confirm_required` (changing nothing) when the engine holds a switch back.
- [ ] Every session LilBot creates starts with the bot's reasoning effort (chats, routine runs, thread runs), unless a
  run passes an explicit `reasoningEffort` (used when its model thinks) or another `model` without one (left unset).
- [ ] Attachments: images as the engine's own image input where it has one, other files as quoted workspace references.
  `imageSupport` is `supported | unsupported | unknown`, never a guess from model names.
- [ ] Optional: `watchActivity` (live status and replay per bot), `conversations` (read-only transcript source for the
  history importer), `onBotsChanged`.

## 3. Hidden runs

- [ ] `runRoutine` runs a prompt in a new hidden full-access session in the bot's folder (routines, thread deliveries
  and webhook runs) with a durable `runId`: the same id recovers the same admission, and an unknown outcome is reported
  as failed (with `unknownReceipt: true`, so the exchange can say LilBot could not confirm how it ended), never repeated.
  When resuming a named `chatId`, it throws `session_not_found` only after confirming the session no longer exists
  (never on a single transient failure). Its sessions are excluded from activity unread, history and both memory reviews.
  Given `toolsets`, the session starts with only those (`server/webhooks/webhook-access.ts`).
- [ ] An engine that continues a long session under a new id after compressing it implements `compressionRoot`
  (the session the lineage began as; read-only), so a continued hidden run stays hidden (`server/bots/hidden-chats.ts`).
- [ ] `reviewMemory` runs a hidden session of the same bot in the `review` access scope, bound only to the narrow per-pass `mcpConnection` supplied in `ReviewOptions` (`lilbot_memory_recall`, `lilbot_memory_save`, `lilbot_memory_forget`), with no access to `lilbot_system` or host tools, and resolves when the turn ends.
- [ ] `stopRun` and `steerRun` interrupt or add text to a hidden or visible running turn (delegation control);
  `steerRun` answers `not_running` on an idle session.
- [ ] `onToolCall` reports every tool start the engine sees, with the declared arguments, from any chat including
  hidden ones. MCP requests carry no session, so this is how LilBot's MCP server tells which conversation called it.

## 4. Reaching LilBot: an MCP client

- [ ] An MCP client for Streamable HTTP with a URL and a bearer token per server, a per-call timeout, and a tool
  allowlist (`McpConnection`, `server/engines/mcp-connection.ts`). `prepareConnections` gives the runtime exactly the
  connections listed, for sessions from their next resume, returns `Promise<boolean>` (`true` only when the runtime's
  connections actually changed or reconnected), and is safe to repeat. Every name starts with `lilbot_`:
  the engine owns those servers (one no longer listed is removed) and never changes or removes any other server, even on
  a name match. A connection marked `optional` (a service a bot added) may fail to connect without failing the bot.
- [ ] `applyConnections(runtime, chatIds)` brings open conversations in step with the connections last prepared, in
  place: from their next message, keeping their context and prompt cache, never by opening a new session or resuming
  one (a resume re-sends the conversation uncached). Per chat it answers `applied`, `unchanged`, `busy` (a turn runs:
  nothing changes in a running turn, and LilBot asks again once it ends) or `not_open` (no live conversation by that
  id: a later resume reads the connections anyway). Timing LilBot relies on: after a service is added, signed in,
  expired or removed, every bot's open main conversation has the change by its next message once the turn that caused
  it has ended; the turn that added a service never sees its tools. LilBot calls it about a second after the change,
  after the call that caused it was answered, because changing a server can abort a call in flight to that server.
- [ ] The tool list is refreshed when the URL changes: LilBot puts a hash of the tool definitions in the query string, so
  a release that changes a tool reconnects every bot once and an unchanged restart changes nothing. The engine must not
  keep a stale list.
- [ ] The connections: `lilbot_system` (LilBot's own tools, [system-mcp.md](system-mcp.md)), `lilbot_t3` (legacy T3
  Code bridge, included only when `LILBOT_T3_ENABLED=1`) and one `lilbot_c_<name>` per MCP service a bot added
  (LilBot's forwarding route; LilBot holds
  the service's sign-in and tokens, the engine only its own key). A bot's key is valid for that bot and that connection
  only; a deleted bot's key is refused. An engine never runs its own OAuth for these: the routes never answer 401.
- [ ] The system note (about 200 words) is delivered as the bot's instructions, the one engine-neutral system-prompt path.
  An engine need not show MCP `instructions`, and must not repeat the note on every turn.
- [ ] If the engine defers or searches tools, say so here: Hermes' Tool Search defers every MCP tool behind
  `tool_search` / `tool_describe` / `tool_call`, so a call can arrive as `tool_call({ name, arguments })`
  (`server/threads/calling-chats.ts` reads both shapes). Report every tool call starting with the engine's own call id;
  a LilBot call whose start is never reported is refused.

## 5. The thin adapter: what MCP cannot do

These stay in the engine's folder because they hook the engine's own turn loop. Each talks to the engine API
(`/engine/*`, loopback only, token plus per-bot capability; `server/http/engine-api.ts`) and holds no data.

| Hook | Does | LilBot side |
|---|---|---|
| Memory block per turn | Supplies the facts a bot needs most, once per turn, fenced as recalled memory and not as user input; static rules go in the system prompt so caching holds | `/engine/memory/context` |
| After-chat review hand-off | Sends each finished turn of a real conversation (not routines, threads, reviews or sub-agents), without blocking the turn | `/engine/memory/turn` |
| Save-before-compress | Hands over every user and assistant message before the engine compresses, and lets the engine compress only once LilBot answers `saved` (or `skipped` for LilBot's own sessions); any other answer keeps the conversation as it is. Waits out a LilBot restart, and lets LilBot tell a turn that stopped for want of the save (`failure: memory_save`) from any other failed turn | `/engine/history/save` |

Memory (`lilbot_memory_recall`, `lilbot_memory_save`, `lilbot_memory_forget`), conversation search (`lilbot_history_search`),
computer tools (`lilbot_computers_list`, `lilbot_computer_*`) and the library's `lilbot_give_file` are all on the system
server, and command safety is enforced in `ComputerService.submit` for every engine. Only the skills plug-in remains on
Hermes while its override is evaluated.

Skills are the one family that is not a plain move. Hermes keeps its own `skills_list`, `skill_view` and `skill_manage`
and its prompt names them, and its `skill_manage` writes straight into the shared library; the Hermes plug-in overrides
the three so every write goes through LilBot's checks and author record ([hermes-engine.md](hermes-engine.md#skills-plug-in-skills-adapter)).
An engine without skill tools of its own would get a `lilbot_skills` tool on the system server, calling the same
`SkillsService` that `/engine/skills/*` does; that is not built until such an engine exists.

## 6. Safety

- [ ] An engine in development creates and binds only `dev-` runtimes and checks the attach receipt's home before
  connecting; production ignores `dev-` runtimes (`server/environment.ts`).
- [ ] Nothing is patched in the engine program: configure it or build on its API. Wire fields LilBot uses are listed in
  the engine's contract test (Hermes: `tests/engines/hermes/hermes-contract.test.ts`).

## 7. Done means

An engine is ready when the unit and contract tests pass and these checks pass against it on the development setup
(`bun run dev:setup` equivalent for the engine): `check:live` (chat, stop, resume), `check:reasoning`,
`check:memory`, `check:history`, `check:system`, `check:threads`, `check:delegation`, `check:routines`, `check:skills`,
`check:computers`, `check:attachments`, `check:connections` and `check:restart`.
