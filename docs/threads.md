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
in groups `point` (the leader's point for one member) and `round` (a round's replies for the leader). Delivery states: `pending`, `steered` (reached a running turn directly), `done`.

## Delegation rules and limits

- Any bot may hand work to any other, never itself. One `lilbot_delegate` call names several bots, one task each; each
  task is its own exchange and the call's tasks share a `batchId`. `exchangeId` continues the same work. Each exchange
  has a nullable `parentId` (`thread_links`): the delegating bot's work item it was handed out under (see
  [work.md](work.md)). The plug-in tools `ask_bot` and `list_bots` ended with adapter 0.10.0 (#113): new sessions use
  `lilbot_delegate` and `lilbot_bots_list`; the engine API's `threads/ask` and `threads/bots` stay only for sessions
  that loaded 0.9.x.
- The receiver works in its own hidden session with its own instructions, memory, skills, workspace and full access;
  follow-ups reuse it. The delegating bot returns at once; the answer is queued as a hidden input into the exact
  originating session, even if Oscar has since started a new chat. Nested delegation resumes the parent exchange, which
  then reports to its requester. MCP calls carry no session, so `calling-chats.ts` matches each call to its own
  `tool.start` (`BotEngine.onToolCall`, with the engine's call id): same bot, tool and `requestId`, seen at most 15
  seconds before the call or within 5 seconds after, and not matched to another call yet. A call whose start is not
  seen in time, or that two sessions could have made, is refused with a retryable error (`session_unknown`), never
  guessed (#174). The activity observer reports only calls still under way: none from an idle session, none that
  completed in the same replay. A goal's review passes its matched session on to the work board (`actFrom`).
- Status per exchange: `waiting` (accepted, not started), `working` (with the receiver's live activity line, in memory,
  and run time from `startedAt`), `finished`, `failed`, `cancelled` (with `stoppedBy`: the bot or Oscar).
- Control is the delegating bot's only: status, cancel, redirect, wait (`lilbot_delegation`). Cancel interrupts the
  receiver's hidden session (`BotEngine.stopRun`) and drops its queued work; whatever still arrives is kept in the
  record as `withheld` and never delivered. Redirect is bot text like a request, marked `redirect` in the transcript:
  steered into the running turn (`BotEngine.steerRun`), joined to the first turn when the task has not started,
  otherwise the receiver's next turn; a steer the turn never took runs as its next turn. Wait never holds a call open:
  each answer still arrives, and the bot is told once when all are in (folded into the last answer, or a short LilBot
  notice).
- Files travel with a request (`files` per task) or an answer (`lilbot_delegation` `action: attach` by the receiver), by
  path in the sender's own folder, with the chat-attachment limits (20 MB, 10 per message): every path part opened with
  O_NOFOLLOW from the folder's descriptor, regular files only, written exclusive-create into
  `<recipient folder>/exchanges/<exchange id>/` under a generated name. Copies only, never shared paths; names are
  untrusted text. `thread_files` lists each file, its sender and where its copy is (none while not delivered). An
  answer's files are copied when the answer goes out, so a withheld answer's files never move.
- Oscar reads exchanges (`threads.list`, `threads.open`, `threads.changed`) and can stop one (`threads.cancel`,
  recorded as stopped by Oscar; the delegating bot is told). He never writes into them. Both participants read the
  same persisted transcript, including the other bot's tool rows and files per message. A delivered copy downloads
  from `/api/threads/<bot id>/<thread id>/<message id>/<n>` (`ThreadService.file`): the bot must be a participant,
  the copy is read from the recipient's folder without following links and checked against the hash taken when it
  was copied. In a group the bot must be one of its participants (leader or member) and the thread must own the file:
  a file passed in it is read from its shared folder, else from the archive once it has ended (never creating a folder),
  and a file the leader kept (recorded under `keptId`, with its hash, when the group ends) from the leader's own folder.
  A running exchange's view has `redirecting` while a redirect did not reach the running turn and waits for the
  receiver's next step.
- A failed exchange carries `failure` (in `threads.list` and `threads.open`), a short fixed phrase chosen from what
  LilBot knows (`thread-failure.ts`): the receiver's turn ended in an error, LilBot could not confirm how it ended (an
  unknown engine receipt), the receiving bot or the bot that handed it over is gone, the request or answer was too long
  or withheld by the safety check, the message limit. Never an exception's text, a run's output or bot text. A stopped
  exchange stays stopped; a follow-up clears the failure. The task line reads "Failed · <failure>" (older failures have
  none and read "Failed · <bot> could not be reached"); its state still comes from `threads.list`. The `thread` chat
  event also carries `failure` while the thread has one (never on the stored tool line, which history records once).
- The leader's row between its own turns in a group reads "Leading a group" (idle), not working and not "waiting" (that
  status means waiting for Oscar); the working marks are chosen in `ThreadRunner.mark`.
- `bots.list` gives a bot working on a task another bot handed it `workingFor` (exchange id and the delegating bot's
  name), from the deliveries running now (`thread-roster.ts`, with the running groups); the roster row reads "For
  <bot> · <activity>". Each of a bot's `groups` entries adds `activity` while its own turn in that group runs and a tool
  call has been seen in it (the runner's live line; a tool call in a group also pushes `bots.changed`): "In a group ·
  <activity>".
- Main conversations get one `tool` reference with `threadId` per exchange (in snapshots and idempotent `thread` chat
  events), merged at the HTTP edge, never written as fake user messages.
- Hidden session aliases are persisted before submission and excluded from after-chat reviews, also after restart.
  Thread activity sets working/finished without unread (on both bots of an exchange; in a group, on the member taking a
  point and on the leader only for its own turns); only the asking bot's visible answer to Oscar can mark it unread.
  Status and activity changes push a plain `threads.changed`; the per-bot chat lines are rebuilt only when exchanges
  are added or settle.
- Limits are in `thread-limits.ts`: depth 3, 20 messages per thread with the answer reserved, 20,000 characters per
  request, 6 deliveries running at once (measured on the dev gateway), 8 exchanges under way per delegating bot. A
  limit refuses further work and tells the bot to report back.
- Bot text passes memory-style secret, hidden-character and instruction-override checks and is delivered in a named,
  JSON-quoted fence, never as Oscar's instructions. Delivery and admission ids are persisted and reused across
  transport failures and restarts (the routine runner's receipt machinery); a terminal unknown receipt is never
  resubmitted with a new identity. A stop recorded while LilBot was down is applied when the delivery is picked up.

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

A group is a thread with more than two participants: its first participant leads, 2 to 4 others are members, and `group`
on the thread holds the purpose, rounds, total turns, end and kept files (`thread_groups` beside it). It runs on the
same outbox, receipts, hidden sessions, file copies and fences as delegation (`group-*.ts`). One tool, `lilbot_group`,
with an action field: `start`, `say`, `attach`, `close`, `status`.

What Oscar approved through the screens (#136) is built as the design thread proposed; the lifecycle rules and choices
below are this implementation's.

- **Starting and rounds.** Any bot may start a group from any session except a group session (no group inside a group;
  members may still delegate to one bot). Retries with the same `requestId` find the same group or round. The first
  point goes with the start. The leader's point (to all, or to named members) becomes one `point` delivery per member,
  run in parallel in each member's own hidden group session. A member's final response is its reply. When every member
  a point was for is done, one `round` delivery takes the replies to the leader's own hidden group session, in the same
  transaction; there it says the next point or closes. A member's own delegation answered later into its group session
  joins the discussion. Who has replied, member states (`waiting`, `working` with the live activity line, `replied`,
  `idle`) and the round's addressees are worked out from the deliveries and the runner, never stored twice.
- **Ending** (`group-end.ts`, once, in one transaction): the leader closes with an outcome; Oscar stops it
  (`threads.cancel`, recorded as stopped by Oscar); or it ends by itself at the round limit (once the last round's
  replies are in), the message limit (a point that does not fit is refused; a group with no room for another round
  ends), the time limit, going quiet (nothing queued or running, no point for 15 minutes) or an unreachable leader. The
  outcome, or LilBot's reason with the replies the leader had not seen, is a `notice` into the conversation the group
  was started from, and each member gets a private journal fact (purpose, how it ended, the outcome, its own part; a
  shorter one when memory refuses). Then turns still running stop (on close, not the leader's own), exchanges members
  handed out from the group stop, their unfinished work items drop and the folder is archived; that part retries until
  done. Late words are kept as `withheld`. An ended group is read-only.
- **Shared folder:** `<workspaces>/.groups/<group id>/`, created through no-follow descriptors. Files from a point or a
  member's `attach` are copied in with delegation's rules and listed with their full path in each prompt. On close the
  leader's `keep` copies files into its own folder (`groups/<group id>/`) and gives them to its Library (the same
  `LibraryService.give` as `lilbot_give_file`), before the folder moves to `<workspaces>/.archive/.groups/<group id>/`.
- **Oscar's view:** `threads.list` and `threads.open` include groups (`group` with members' states, rounds with who
  replied, the round limit, turns, end and kept files), `threads.changed` and `threads.cancel`. `bots.list` gives each
  bot the running groups it is in (`groups`: id, purpose, round, round limit, leading), pushed with `bots.changed` when
  a group starts, opens a round or ends. Each participant's main conversation gets a `group` / `in <leader>'s group`
  line.
- **Limits (`GROUP_LIMITS` in `thread-limits.ts`):** 4 members, 6 rounds, 40 messages, 120 minutes, 15 quiet minutes, 2
  running groups per leader, 6,000 characters per earlier message in a prompt. `LILBOT_GROUP_TEST_ROUNDS` lowers the
  round limit for a dev server with the test data folder and allowlist; production refuses it.

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

