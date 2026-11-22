# Connections: T3 Code and MCP services

`server/connections/` owns LilBot's external MCP connections: the shared T3 Code coding bridge and the MCP services bots
add (#187). Short summaries and trust boundaries are in `AGENTS.md` under "Coding (T3 Code)" and "Connections: MCP
services bots add (#187)".

## Coding (T3 Code)

Coding goes to T3 Code, Oscar's coding backend, through its MCP tools. LilBot builds no coding engine, worktree or
pull-request handling. Running commands, reading files and using apps stay ordinary bot work.

- The T3 connection (`server/connections/t3-connection.ts`) is given to every bot by every engine
  (`BotEngine.prepareConnections`, on creation, startup and before use). With the system server and bot-added MCP
  services it is an exception to "tools and MCP connectors stay with the engine".
- The bridge (`t3-bridge.ts`, `/engine/t3/mcp`) forwards Streamable HTTP MCP to T3 Code (`LILBOT_T3_MCP_URL`). Callers
  present a per-bot key (`HMAC(engine token, "t3-bridge:<bot id>")`); deleted bots are refused. It narrows the tool
  list to `T3_TOOLS` (no project deletion, themes, schedules or machine linking) and prefixes each `clientRequestId`
  with the bot id, because T3 scopes retry keys to the one shared sign-in.
- One shared sign-in with Full access in `<data>/t3-grant.json` (0600). `bun run t3:sign-in` redeems a one-time
  pairing code Oscar creates in T3 Code on the leader's environment (Settings → Sharing & access → Create link → Copy
  code; the link works too; codes last about five minutes). T3 has no refresh grant: the sign-in lasts 30 days, then
  Oscar approves again. The running server picks up a new sign-in without a restart.
- Missing, expired or revoked: the bridge answers MCP itself with one tool, `t3_connection_status`, telling the bot
  what to tell Oscar. A T3 401 on an unexpired grant marks it revoked; the 401 is never passed on, so an engine never
  starts its own OAuth. `connections.status` returns state and expiry, never the token. No Settings screen yet
  (`needs-ui`).
- Bot instructions are the skill `t3-coding` (`server/connections/t3-coding-skill/SKILL.md`), installed into the
  skills library at startup and restored if it differs: one launch with a stable `clientRequestId`, then
  `t3_thread_wait`/`t3_thread_read`, with the T3 `link` in the chat right away and with the result. An uncertain
  launch retries the original `clientRequestId`, never a replacement task. There is no LilBot follow-up queue after
  the Hermes turn ends.
- `check:coding` runs its real task in the project root of a throwaway repo (T3's MCP has no worktree removal) and
  revokes its own sign-in at the end. T3 recovery has a unit test with a simulated upstream; the live grant is never
  copied into tests.

## MCP services bots add (#187)

A bot adds an MCP service when asked ("connect Notion"); LilBot connects to it, does the OAuth sign-in, holds the
tokens and keeps the state, and every bot uses its tools in its open conversation from the next message, with no new
session. The list, sign-in and tokens live in LilBot, so changing engine changes none of it. Code:
`server/connections/mcp-*.ts`, `connection-apply.ts`, wired in `server/app-connections.ts`. Bot guide topic:
`connections`.

- A connection: id, name (unique; the engine's server is `lilbot_c_<name>`, so it never meets Oscar's own servers),
  address, state, the bot that added it, created and last-worked times, the tool names LilBot last read. States:
  `needs_sign_in`, `connected`, `sign_in_expired`, `unreachable`. Every bot gets every connection; per-bot switches and
  "used for" (#62) can add a table without changing this one. At most 20.
- Bot tool: `lilbot_connection` with `action` (`add` name and address, `sign_in` id, `finish` the pasted address,
  `remove` id; a `requestId` each). Status is a read: `lilbot_status` area `connections` (id, name, address, state, last
  worked, tool count; never a token). Only the bot that added a service removes it, any bot once that bot is gone (the
  exception to "no destructive tools", like its own webhooks and routines). `add` and `sign_in` are traced to their
  conversation like `lilbot_delegate`. Browsers: `connections.status` gains `services`; `connections.changed`.
- Names and addresses are untrusted text: a name is 2 to 31 of `[a-z0-9_]`; an address is HTTPS or loopback HTTP, with
  no user name, password, fragment or secret (`memoryRefusal`). Every endpoint a service names is checked the same way,
  and a service on the internet may not point LilBot at this machine. Nothing follows a redirect.
- `add` probes the address (initialize, tools/list; ten seconds). It answers: connected with its tools, or the service
  asked for a sign-in (401): LilBot discovers its authorisation server (RFC 9728 protected-resource metadata from the
  401's `WWW-Authenticate` or the well-known path, then RFC 8414 or OpenID metadata, issuer checked), requires PKCE
  S256, registers itself (RFC 7591, a public client with one redirect address) and places a sign-in card in the asking
  conversation (see below). No dynamic registration: refused for now (API keys are #63).
- The sign-in: authorisation code with PKCE, `state` and the resource indicator (RFC 8707) on authorize, token and
  refresh. The return address is `https://<LILBOT_ACCESS_HOST>/api/connections/callback`, from configuration, never a
  request's Host; without the Access door no sign-in can start (services that need none still work). The callback route
  itself is off by default (`LILBOT_ACCESS_CALLBACK_ENABLED=1` opts in); when off, that path answers with a plain 404
  (`no-store`) and never falls through to the app shell; when on, it runs only after Access checks, takes `code`,
  `state`, `iss` and `error`, sets no cookie, shows a plain page (`no-store`, `default-src 'none'`, no referrer) and
  never logs its address. The pasted-address flow works without it.
- A sign-in is spent by the first answer naming its `state` (valid or not), works only within ten minutes of the `add`,
  `sign_in` or `restart` that started it (`sign_in` is refused while connected or unreachable), and a new one voids the
  one before; `iss` is checked against the issuer when sent, and required when the server promises it. OAuth endpoints
  must share their issuer's origin.
- Legacy bot paste fallback (`lilbot_connection` action `finish`): kept working for clients without the card. Oscar
  pastes the address his browser ended on in chat and the bot passes it with `finish`; it must be LilBot's return
  address exactly, match the flow's calling bot and conversation, appear in one of Oscar's own visible user messages in
  that conversation, and is validated like the callback (also updating the matching sign-in card to `connected`). It is
  kept out of `system_changes` (field names only) and LilBot's logs.

### Sign-in cards in conversation (#216)

When `add` or `sign_in` starts an OAuth flow, LilBot does **not** return a sign-in URL or OAuth `state` to the bot.
Instead, it places a durable sign-in card in the asking conversation and returns `{ id, name, state, tools, cardId,
address, signsInAt, note }`, telling the bot to wait for LilBot to notify it when Oscar finishes.

- **Schema (`shared/connections-schema.ts`, `shared/chat-schema.ts`, table `connection_sign_in_cards`, migration 38):**
  - `ChatItem`: `{ kind: 'connection.sign_in', card: ConnectionSignInCard }`, persisted in `history_items` under id
    `sign_in:<card.id>` (with `author: 'system'` and empty FTS `text`) so it survives page reloads via `chat.open` /
    `chat.history`.
  - `ChatEvent`: `{ type: 'connection.sign_in', card: ConnectionSignInCard }`, pushed live over `{ event: 'chat', chatId,
    data }` to every open browser viewing that conversation (alongside `history.changed`).
  - `ConnectionSignInCard` fields: `id`, `connectionId`, `botId`, `chatId`, `serviceName`, `serviceAddress`,
    `providerDomain` (`signsInAt`), `state` (`'waiting' | 'connected' | 'cancelled' | 'expired' | 'failed'`), optional
    plain-text `reason`, optional plain-text `label`, `createdAt`, `expiresAt`, `settledAt`.
  - **Never stored, broadcast or logged:** the sign-in URL, OAuth `state`, PKCE verifier and pasted callback address
    stay in memory only (the pasted address is discarded immediately after validation/exchange) and never enter SQLite,
    conversation history, broadcasts, bot tool results, model context, memory or logs.
  - Bot-provided `label` / `reason` are untrusted plain text (control characters stripped, length-capped, checked with
    `memoryRefusal`). Failure `reason` strings are always fixed generic LilBot messages (never raw upstream OAuth
    errors).
- **Replacement, expiry and restart:**
  - A second `add`/`sign_in` for the same connection while a card is `waiting` updates that waiting card in place when in
    the same conversation (no duplicate card), or marks an earlier waiting card in another conversation `expired`, and
    voids the prior in-memory flow. Removing a connection cancels its waiting cards.
  - When a waiting card's 10-minute window elapses (`LILBOT_CONNECTION_TEST_SIGN_IN_SECONDS` in dev checks) or after a
    LilBot server restart (when in-memory flows are gone), the card transitions to `expired` (reconciled on startup, on
    the 1-second connections tick, and before `chat.open`, `chat.history`, and card actions), updating history and
    pushing to open browsers.
- **Browser requests (Oscar's browser WebSocket only; bots cannot call them):**
  - `connections.signIn.open({ cardId })` → `{ url }`: returns the live sign-in URL on demand only while the card is
    `waiting` and unexpired (same on-demand boundary as `webhooks.address`); never broadcast or stored.
  - `connections.signIn.finish({ cardId, address })` → `ConnectionSignInCard`: validates the pasted callback address
    strictly against `redirectUri`, `state`, `iss`, single-use **and** binds it to `cardId`'s pending flow (mismatched,
    other-card, reused or expired addresses are refused without spending another card's flow). Exchanges the code,
    probes the service, updates the card to `connected` (or `failed` with a generic plain reason), pushes to browsers,
    and sends the bot its hidden turn (`"<name> is connected"` or failure notice).
  - `connections.signIn.cancel({ cardId })` → `ConnectionSignInCard`: voids the in-memory flow, marks the card
    `cancelled`, pushes to browsers, and sends the bot a hidden cancellation turn so it does not hang.
  - `connections.signIn.restart({ cardId })` → `ConnectionSignInCard`: while `waiting`, or if `expired`/`failed` while
    the service still needs sign-in, voids the previous flow, mints a fresh 10-minute flow for the same card (clearing
    prior `reason`/`settledAt`), pushes to browsers, and returns the updated card (**not** the URL; the UI calls
    `connections.signIn.open` on demand when Oscar clicks Sign in).
- **Automatic callback & trust boundaries:**
  - `GET /api/connections/callback` remains strictly on the Access door behind `LILBOT_ACCESS_CALLBACK_ENABLED=1` and
    Access JWT/Host/Origin checks (never on the helper door or private listener). Completing or failing a flow through
    it updates the matching sign-in card, pushes to open browsers, and sends the bot its hidden outcome turn.
- Tokens and any client secret are only in `<data>/mcp-credentials.json` (0600, written whole and renamed). Never in a
  tool argument or result, chat, instructions, memory, the conversation copy, logs or an engine's settings: engines get
  LilBot's route and the bot's key (`HMAC(engine token, "mcp-service:<id>:<bot id>")`), so a refresh needs no engine
  change. LilBot refreshes 30 seconds before expiry or after a 401, one refresh per service at a time; a refused refresh
  (or none possible) is `sign_in_expired`, repaired by a new `sign_in`.
- The route (`mcp-forward.ts`, `/engine/connections/<id>/mcp`, private listener only, like the T3 bridge): loopback
  Host, no Origin, the bot's key for this service, current bots only, POST and DELETE only (no stream the service
  opens). It forwards with the token, offers only the tools LilBot gave the engine, and fences every text result as
  `<outside-service-output>` data. A 401 is never passed on; while signed out it answers MCP itself with one tool,
  `connection_status`, saying what to tell Oscar. Setup calls wait ten seconds and tool calls 120; a service that does
  not answer is `unreachable` and holds up nothing else (`optional` connections never make a bot unavailable).
- Picking it up without a new session (`connection-apply.ts`, `BotEngine.applyConnections`): a watcher ticks every
  second; when what engines are given changes (added, signed in, expired, removed, new tools) it gives every bot its
  connections again, then applies them in place to each bot's main conversation; a conversation whose turn runs is asked
  again once it ends, so the turn that added a service never sees its tools but the next message does. Being on a
  timer, it never reconfigures a service while the call that caused the change is still being answered (that would abort
  the call). After a sign-in, the conversation that asked gets a hidden turn ("<name> is connected"), only once its
  tools are applied there. Nothing is imported from or deleted in the engine profiles: Oscar's `revenuecat` and `paper`
  stay.
- Output from a service is data, never Oscar's instructions; tool descriptions it lists reach the model's listing as
  they are.
