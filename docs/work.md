# Work board and check levels

`server/work/` owns the work board (`shared/work-schema.ts`, `shared/work-check-schema.ts`): every real piece of bot
work is an item Oscar can see, with who asked, who owns it, how "done" is defined, the evidence and the result. The
short version is in `AGENTS.md` under "Work".

## Work items

What must always happen is built in; what takes judgement is the `lilbot-work` skill
(`server/work/work-skill/SKILL.md`, installed into the skills library at startup and restored if it differs, like
`lilbot-coding`).

- An item: id, title, owner (name captured at opening), who asked (`oscar`, `bot`, `routine`, `webhook` or `self`),
  origin (`conversation`, `exchange`, `group`, `routine_run`, `webhook_run`), the "done" definition, kind of work, check
  level (0-3) and the kind's default when it got its kind, status (`open`, `working`, `checking`, `needs_oscar`, `done`,
  `failed`, `dropped`), evidence, result, its checks, times, an optional parent and an optional goal (see
  [goals.md](goals.md)). Statuses and kinds are checked in code, not SQL. `work_events` keeps every change with where
  it came from.
- Who asked and the origin come from LilBot's records of the calling session (`app-work.ts`, `workSessions`): an
  exchange's hidden session is the exchange, asked by the delegating bot; a routine or webhook run's session is the run,
  asked by the routine or webhook (named by its task); anything else is a conversation, asked by Oscar unless the bot
  says `self`. A session the engine continued after compressing one of those counts as it (`bots/hidden-chats.ts`,
  `sessionRoots`, the lookup the hidden-session check uses); while its lineage cannot be read the work call is refused
  rather than credited to Oscar. A group session is the group (origin `group`), asked by its leader; the leader's own
  group session is its own work (`self`).
- Rules: opening needs a kind; with a definition (or at level 0) it starts the work; `working` needs the definition and
  a kind; `done` needs them, at least one evidence entry and a result, unless the item is at level 0. Only the owner
  reports on its item; the caller is the key's bot. `needs_oscar` carries exactly one question; a second while one waits
  is refused. `failed` needs a result, `dropped` a reason. Final items take nothing more. Nothing is deleted.
- Evidence: what it proves plus exactly one pointer: a Library item of the owner (checked), a url, a command with its
  output, or a number with its source and time. All work text passes `memoryRefusal` (no secrets, hidden characters or
  instructions); output is capped at 4,000 characters.
- `needs_oscar` uses the activity service like a waiting session (`work:<item id>`): the bot shows waiting and turns
  unread unless Oscar is viewing; leaving it ends the waiting state. The live line is in memory; unread survives
  restarts.
- Delegation: `lilbot_delegate` inside an item (`itemId`, else the caller's only unfinished item in that session) sets
  the exchange's `parentId` and opens the receiver's child item with the exchange's id, asked by the delegating bot, no
  definition yet, in the same transaction. The receiver's prompt names it; its first open from that session fills it in.
  A stopped exchange drops its child item ("The exchange was stopped by ..."). A routine or webhook run that reports on
  an existing item is linked to it (`links`, from the event log).
- Groups: a group started inside an item (`itemId`, else the leader's only unfinished one) sets the group's `parentId`
  and opens each member's child item (`<group id>:<member id>`, origin `group`, asked by the leader) in the group's
  transaction; a member's first point names it, and its first open from its group session fills it in (the item LilBot
  opened has no request id: `WorkStore.prepared`). When the group ends, members' unfinished items for it are dropped
  ("The group closed.", "The group was stopped by Oscar.", "The group ended by itself.").
- An item opened in a conversation leaves a `tool` line there (`workItemId`, `toolId: work:<id>`) in LilBot's history.
- Bot tools (System MCP): `lilbot_work` (no itemId: open; with itemId: definition, evidence and status in one call;
  request ids make retries safe) and `lilbot_work_list` (mine, every bot's, or one in full).
- Oscar: `work.list` (bot, status, updated between `from` and `to`), `work.open`, `work.drop` (with his reason),
  `work.answer`, `work.brief` (needs him, failed and done since a time, the last day by default) and the push
  `work.changed`. Screens: `web/src/work/` ([screens.md](screens.md)).
- An answer is saved, the item returns to `working` (or `open` if it never started), and is delivered once through
  `work_answers`: a hidden turn with a stable run id in the bot's main conversation for work from a conversation,
  otherwise in the session the work came from; transport failures retry after 30 seconds. On an item handed over by
  another bot (origin an exchange) it instead continues the exchange (a thread delivery of kind `oscar`, from the
  delegating bot's side): the receiver's next turn, whose reply returns to the delegating bot as an ordinary thread
  answer in its own session. An exchange that cannot take another message (full, failed) gets the direct delivery, so
  an answer is never lost. The delegating bot reads the question and answer on the child item with `lilbot_work_list`.
- `work.drop` (one transaction) drops the item and every unfinished item below it, with the same reason, and stops the
  work. An exchange's own item stops that exchange as Oscar in the same transaction (`ThreadService.dropped`: the
  delegating bot is told with his reason; only the interrupt of the receiver's turn follows the commit, and the
  runner repeats it after a restart; an exchange that has answered already only tells the delegating bot). Any other
  owner is told in the session the item belongs to through `work_answers` (`drop-<item id>`: stop, report nothing
  further, say so). If it was `working`, the row first waits as `stopping` until the running turn of that session has
  been ended (once), so the bot reads the notice and not its own last words. A secondary item opened inside an
  exchange's session is only told, with no interrupt (ending that turn would end the exchange), and not at all when the
  same drop stops that exchange. A dropped handed-over parent gives its delegating bot two notices: its own and the
  exchange's "Oscar stopped".

## Check levels (#142)

0 no check; 1 the owner reads the real result and attaches evidence; 2 a second bot reproduces the claim (a fresh
session of the owner when no other bot is eligible); 3 Oscar checks. What must happen is built in (`work-check-*.ts`,
`work-checks.ts`, `work-levels.ts`); how to check is the `lilbot-check` skill (`server/work/check-skill/`, installed
like `lilbot-work`).

- Kinds (`shared/work-check-schema.ts`) and built-in levels: `reply`, `note` 0; `file`, `computer`, `code` 1; `deploy`,
  `outside` (a message or post that leaves the system), `spending`, `figure` (a number Oscar decides on) 2. Oscar sets a
  default per kind and per kind for one bot (`work.levels.get`, `work.levels.set`, null removes his; `work_levels`, bot
  id '' for every bot); the bot's wins. "Hard to undo" is not a kind: the skill tells bots to raise the level for it.
- The bot gives the kind at opening (an exchange's item: when the receiver first reports); LilBot refuses a level below
  the effective default and any lowering; raising is allowed until it finishes. An item from before kinds has none: it
  cannot move to `working` or `done` until its bot gives one, which can raise its level to that kind's default.
- Level 2: the owner's `done` (same checks as level 1) moves the item to `checking`, not done; LilBot picks the checker
  in the same transaction (`work_checks`): never the owner or the owner of any item under it, never a choice of the
  owner's (there is no argument for it); among the rest, one that has not checked this item, then the fewest checks,
  then by id. Candidates are bots that are ready or being prepared. A real second bot is always preferred.
- No other bot eligible (Oscar has one bot, or every other bot works under the item): the check is a **same-bot check**,
  never a wait for Oscar. It is a new hidden session of the owner (`by` is the owner, `sameBot` true), told nothing but
  the check prompt (done definition, claim and evidence pointers fenced as data), so it remembers nothing of the owner's
  conversation, read-only by instruction. It runs on `LILBOT_REVIEW_MODEL` when that differs from the bot's own model
  (`WorkHost.checkModel`, `differentModel`; a bot with no model of its own counts as different), else on the bot's own,
  and the check's `note` says which. The choice is saved with the check (`same_bot`, `checker_model`, `WorkCheck.sameBot`
  and `model`), so Oscar's screens can show it, and a restart reuses it. A run with another model starts without the
  bot's reasoning effort (like the memory review).
- The check runs as a new hidden session of the checker (`work-check-runner.ts`, run id `check-<check id>`, both session
  ids saved before the prompt in `work_check_chats`, so it is excluded from history, activity and both memory reviews).
  The prompt gives the done definition, claim and the owner's evidence in a `work-claim` JSON fence, the owner's folder
  and the verdict's request id (`verdict-<check id>`). Retries and restarts reuse the run id.
- A check session, same-bot or a second bot's, gets no memory and changes nothing but its verdict (#174;
  `work/check-sessions.ts`, by both saved ids and the compression lineage). The engine API answers its memory context
  with an empty block (no deployment notice either) and refuses its recall, writes, forgets and conversation search, by
  the session id the adapter sends; with no session id, while a check of that bot runs. Skill changes name no session,
  so the skills plug-in's writes are refused while a check of that bot runs. It starts with the neutral `access: 'check'`
  scope, which each engine maps to its own check-only tool controls (no memory, scheduling, delegation or coding). LilBot's MCP server
  refuses it every changing `lilbot_*` call and `lilbot_memory_list`; only reads and the verdict pass
  (`system/check-access.ts`: while a bot checks, its calls are matched to their starts by request id or arguments; one
  not seen in time is refused). Files and the terminal can still write: read-only stays an instruction there. Refusals
  log fixed labels (`[check-session]`, `[work-check] verdict refused: <code>`, a check that ended without a verdict with
  its end status and whether it was a same-bot check).
- The verdict comes only through `lilbot_work` (`verdict`, `result`, the checker's own evidence) from the assigned bot,
  from that check session (`work_check_chats`): for a same-bot check the owner's main and every other session are
  refused, though it is the same bot. `verified`: done. `not_verified`: back to `working`, the owner told once through
  `work_answers` with what the checker saw (fenced); a second failure waits for Oscar. `could_not_check`, a run that
  ends without a verdict, or a checker that is gone: waits for Oscar. While a check is open the owner can report nothing.
  These notices (and Oscar's send-back) reach a handed-over item's owner in its own session, not through the exchange.
- Oscar's checks: level 3, a second failure or a check that could not be done put the item in `needs_oscar` with an
  open Oscar check. `work.pass` (optional note): done. `work.sendBack` (reason): back to `working`, the owner told.
  `work.answer` refuses these. Dropping an item closes its open check.
- A level 2 or 3 item is done only as `verified` (a bot) or `passed` (Oscar): every summary carries its latest `check`,
  and an item carries all of them. Track record and spot checks are not built (proposal on #142).
- The note has two static lines on when to open an item: before any work beyond a reply, however small (changing
  something, handed over, scheduled or from outside), not for answering a question.
