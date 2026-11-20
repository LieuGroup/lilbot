# Threads and delegation

Rules and the short version are in `AGENTS.md` under "Threads". Code: `server/threads/`, tools in
`server/system/tool-delegation.ts`, schema in `shared/thread-schema.ts`.

## Parts

| File | Does |
|---|---|
| `thread-store.ts` | `threads` (JSON transcript and status), `thread_links` (batch, parent), `thread_deliveries` (the outbox) |
| `thread-runner.ts` | the outbox: runs each delivery in its bot's hidden session, keeps status, records answers |
| `thread-service.ts` | `ask` (the engine API's legacy `threads/ask`, kept for sessions on adapter 0.9.x), reading (bots and Oscar), stopping |
| `delegation-service.ts` | the MCP tools: delegate in batches with files, status, redirect, wait, attach |
| `exchange-files.ts`, `thread-files.ts` | copying files safely; `thread_files` records them |
| `thread-waits.ts` | "tell me when all are in" |
| `calling-chats.ts` | which conversation made an MCP call |
| `thread-prompts.ts` | what a bot is told |

Delivery kinds: `request` (work), `redirect` (a change of course), `answer` (a reply back), `notice` (LilBot's own word:
"Oscar stopped it", "all are in"). Delivery states: `pending`, `steered` (reached a running turn directly), `done`.

## Engine findings (dev gateway, 2026-11-20)

- **Stop:** `session.interrupt` with the generation from `session.resume(omit_messages)`, sent from a second socket
  while the run's own socket waits on `prompt.receipt`, ended a hidden turn inside `sleep 40` in about a second; the
  receipt's outcome was `interrupted`. LilBot never patches Hermes for this.
- **Steer:** `session.steer` during a tool call answered `queued`; the text became a user row with `display_kind:
  steer` after the tool batch and the reply followed it. On an idle session it fails with `hermes_stale_generation`, so
  LilBot falls back to the receiver's next turn. `session.redirect` (which also cancels the in-flight model request) was
  not used.
- **Visibility:** hidden `tool` sessions are not in `session.list` and have no `session.events.since` replay; the socket
  that submitted the run receives their events live, `tool.start` with full `args`. That socket feeds the activity line
  and `BotEngine.onToolCall`.
- **MCP:** Hermes' MCP client sends no session id or header per conversation. With tool search on, a call may arrive as
  `tool_call({ name, arguments })`; `calling-chats.ts` reads both shapes.

## Concurrency (dev gateway, 12 cores, trivial hidden turns, 2026-11-20)

| at once | wall | median turn | gateway RSS | gateway CPU |
|---|---|---|---|---|
| 1 | 2.6 s | 1.6 s | 812 MB | 0.9 s |
| 2 | 2.7 s | 1.7 s | 813 MB | 1.1 s |
| 4 | 3.9 s | 2.1 s | 814 MB | 2.7 s |
| 8 | 5.4 s | 2.7 s | 814 MB | 4.4 s |

Memory stays flat; latency grows about 70% at eight. `concurrent` is 6, leaving room for real turns, which run tools
and share the upstream model allowance with production.

## Files

- A request's files are checked first (all or nothing), then copied before the exchange is accepted; a retried
  `requestId` copies nothing, and copies from a refused or raced accept are removed through the folder's descriptor.
- A receiver attaches answer files only while one of its deliveries for that exchange runs. They are checked then and
  copied when the answer goes out; one that vanished or became a link since is listed with no copy.
- Copies are `exchanges/<exchange id>/<8 hex>-<name with anything outside [A-Za-z0-9._-] replaced>`, mode 0600, in the
  recipient's folder; SHA-256 recorded.

## Redirect and stop, step by step

- Redirect: recorded as a `redirect` delivery and transcript message. If a delivery of the exchange runs with a known
  session, it is marked `steered` and sent with `steerRun` (fenced bot text carrying the redirect id). When that turn
  ends, LilBot looks for the id in the turn's user rows: found, it is done; missing, it becomes `pending` and runs as
  the next turn. A redirect sent before the task starts joins the task's first prompt.
- Stop: the exchange is marked `cancelled` with `stoppedBy` first, queued work is dropped, then the running turn is
  interrupted. The running delivery settles itself when the engine returns, so its words are kept as `withheld`. Its
  session-creation and baseline callbacks refuse to go on once stopped, so nothing new is admitted; after a restart the
  outbox applies the stop again instead of running.
