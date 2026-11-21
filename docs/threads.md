# Threads, delegation and temporary groups

Rules and the short version are in `AGENTS.md` under "Threads". Code: `server/threads/`, tools in
`server/system/tool-delegation.ts` and `tool-groups.ts`, schema in `shared/thread-schema.ts`.

## Parts

| File | Does |
|---|---|
| `thread-store.ts` | `threads` (JSON transcript and status), `thread_links` (batch, parent), `thread_deliveries` (the outbox) |
| `thread-runner.ts` | the outbox: runs each delivery in its bot's hidden session, keeps status, records answers |
| `thread-service.ts` | `ask` (the engine API's legacy `threads/ask`, kept for sessions on adapter 0.9.x), reading (bots and Oscar), stopping (`stopping` is its database part, which the work board runs inside its own transaction), Oscar's answer and drop on a work item |
| `delegation-service.ts` | the MCP tools: delegate in batches with files, status, redirect, wait, attach |
| `exchange-files.ts`, `thread-files.ts` | copying files safely; `thread_files` records them |
| `thread-waits.ts` | "tell me when all are in" |
| `calling-chats.ts` | which conversation made an MCP call |
| `thread-prompts.ts` | what a bot is told |
| `group-service.ts`, `group-open.ts` | the `lilbot_group` actions; opening a round |
| `group-rounds.ts` | the runner's group hooks: which deliveries work in a group, recording a turn, settling a round |
| `group-end.ts` | ending once, the outcome and journal facts, the work after the end, time and quiet |
| `group-store.ts`, `group-folder.ts` | `thread_groups` and the group's deliveries; the shared folder and its archive |
| `group-prompts.ts`, `group-view.ts` | what group members and the leader are told; Oscar's view, the bots' status, the roster |

Delivery kinds: `request` (work), `redirect` (a change of course), `oscar` (Oscar's answer to the receiver's question on its
work item, #156: work like a request, sent from the delegating bot's side, never checked as bot text), `answer` (a reply
back), `notice` (LilBot's own word: "Oscar stopped it", "Oscar dropped the work item", "all are in", a group's outcome), and
in groups `point` (the leader's point for one member) and `round` (a round's replies for the leader). Delivery states:
`pending`, `steered` (reached a running turn directly), `done`.

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
  `tool_call({ name, arguments })` or `tool_call({ calls: [...] })`; `calling-chats.ts` reads both shapes. Each start
  is matched to one call; a call whose start is not seen in 5 seconds is refused, never given the main conversation.

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
  recipient's folder; SHA-256 recorded. Downloads open every folder without creating or following anything.

## Redirect and stop, step by step

- Redirect: recorded as a `redirect` delivery and transcript message. If a delivery of the exchange runs with a known
  session, it is marked `steered` and sent with `steerRun` (fenced bot text carrying the redirect id). When that turn
  ends, LilBot looks for the id in the turn's user rows: found, it is done; missing, it becomes `pending` and runs as
  the next turn. A redirect sent before the task starts joins the task's first prompt.
- Stop: the exchange is marked `cancelled` with `stoppedBy` first, queued work is dropped, then the running turn is
  interrupted. The running delivery settles itself when the engine returns, so its words are kept as `withheld`. Its
  session-creation and baseline callbacks refuse to go on once stopped, so nothing new is admitted; after a restart the
  outbox applies the stop again instead of running.

## Temporary groups (#133)

What Oscar approved through the screens (#136) is built as the design thread proposed; the choices below are this
implementation's.

- **Where things run.** Members and the leader each get one hidden group session (`thread_chats` to the group), reused
  every round, so a member keeps its own context and the after-chat review never sees it (`isInternal`, and through
  `hidden-chats.ts` its compression continuations). The leader's main conversation sees only its start call, the
  group line and, at the end, the outcome turn.
- **Ids.** `group:<id>:<round>:<member>` for a point, `group:<id>:<round>:leader` for a round's replies,
  `group:<id>:end` for the outcome; the point message is `group:<id>:<round>` and each reply `<delivery id>:reply`.
  Every enqueue is `INSERT OR IGNORE`, and a turn's reply, the round's settling and the leader's delivery are one
  transaction, so a restart can neither lose a round nor repeat one. The runner orders deliveries per member within a
  group (`<group>\n<member>`), so members run in parallel while each member's turns stay in order, a delegation answer
  into its group session included.
- **Prompts.** Built when a point or round is queued and stored as the delivery's text (`point`, `round` and `notice` are
  LilBot's own prompt; the bot text inside was checked and fenced when it was built). Each carries only messages the bot
  has not been shown (`group.seen`), each cut to 6,000 characters; the full discussion, tool rows included, is
  `lilbot_group` status. The leader's first round prompt repeats the purpose and its first point, since its group
  session starts empty.
- **The leader's turns.** Its tool lines join the point it made in that turn; a turn that made no point is a message of
  its own (so a leader that only talks stays visible). The turn that closes the group counts in the total.
- **Round limit.** The group ends by itself as soon as the last allowed round's replies are in, without another leader
  turn; the replies go with the reason to the conversation it was started from, where the leader writes its outcome.
  The leader's prompt before the last round says so.
- **Turns.** Every member and leader turn recorded before the end, plus the closing turn. Late turns count nothing.
- **Files.** One copy per file in the group folder (not one per member): members read it by full path. A kept file is a
  copy of that copy in the leader's own folder, so the Library item survives the archive. A copy of a copy gets one
  fresh prefix, not two. Kept files are recorded in `thread_files` in the end transaction under `<group id>:kept` (with
  the hash), so the same download route serves them; passed files are served from the group folder, then the archive.
- **Journal facts** are written in the end transaction, `kind: journal`, `scope: bot`, `author: bot`, `via: chat`, with
  the member's group session as the source chat (memory has no `via` for LilBot itself; the Memory panel shows it as
  learned in a chat). The longest of three versions that memory accepts is saved; a refusal never blocks the end.
- **Work after the end** (`settle`) is marked done in `thread_groups.settled` and retried from the tick (30 seconds
  after a failure) until the folder is archived.
- **Oscar on a member's item.** A member's child item is an ordinary item to the board (#160): his answer or drop reaches
  the member as a turn of its own in its group session, outside the discussion, and a drop interrupts the member's
  running turn, which then counts as its reply.
- **Roster.** `bots.list` carries `groups` per bot instead of a new method, so the existing `bots.changed` push keeps the
  roster's "Working together" section and members' row states current.

## Tool cost (#133, against main at de6f103, characters from `systemFixture`)

| | before | after |
|---|---|---|
| listing lines Hermes shows every turn (name and first sentence) | 3,290 (32 tools) | 3,452 (+162: `lilbot_group`) |
| full `tools/list`, fetched only by `tool_describe` or an eager engine | 13,410 | 14,709 (+1,299) |
| the note | unchanged | unchanged |

Per turn that is one listing line, about 40 tokens at #154's 45 a tool. `lilbot_group`'s schema is 864 characters, read
only when a bot looks the tool up; the guide topic `groups` adds one name to `lilbot_guide`'s topic list. One tool with
an action field instead of five: a status call is a read and leaves no change record (`McpTool.readOnly` may be a
function of the arguments).

