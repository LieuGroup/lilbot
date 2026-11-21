# Commands and live checks

Every `check:*` and `bun live-checks/*.ts` follows the development rules in `AGENTS.md`: dev launcher
(`scripts/dev-env.ts`), temporary `dev-` profiles, isolated directories under `~/lilbot-dev/runs/`, cleanup in
`finally`. Run live checks one at a time after `bun run dev:setup`. Most cost a few model calls.

## Core commands

- `bun run verify`: lint, typecheck, knip, file-size and `AGENTS.md` checks, unit and contract tests, web build into
  `dist/`, then a growth report (lines per folder, web first-load size). `bun run format` applies formatting.
- `bun run dev:setup`: create or repair the development home (`~/lilbot-dev/`) and start `lilbot-dev-hermes.service`.
- `bun run dev`: Vite with hot reload, proxying to a dev server on `LILBOT_PORT` (default 3371); production ports are
  refused. `bun run start`: run the server (`LILBOT_PORT`, `LILBOT_HOST`).
- `bun run deploy` (`--status`, `--bootstrap`): build and roll out a verified commit; see [deploy.md](deploy.md).
- `bun run t3:sign-in`: redeem a T3 pairing code from stdin or `--code-file`, into `LILBOT_DATA_DIR`.
- `bun run build:helper`: build the standalone computer helper. `bun run build:helper-downloads [data dir]`: build the
  Linux downloads for a server.
- `bun run history:exclude -- --bot <id> --session <id> --reason "<text>" [--yes]`: operator CLI to permanently remove
  one non-main engine session from LilBot's history copy (previews without `--yes`).

## Live checks

- `bun run check:live`: a temporary bot with a throwaway memory endpoint chats, stops, resumes and is deleted.
- `bun run check:reasoning`: on an isolated server, the effort is readable before a message, a model and effort edit
  applies from the next message (between turns and mid-turn, with the earlier context kept), and a routine run and a
  bot thread start with the bot's effort.
- `bun run check:model-switch`: a switch to a smaller window compacts first and the save-before-compress hook runs; a
  switch of a 100,000+ token conversation is refused with `confirm_required`.
- `bun run check:memory`: tells a temporary bot facts and checks a new session knows them; prints tokens per turn.
  Inherited memory is disconnected before the baseline turn.
- `bun run check:history`: continuous history, paging and search, tool lines after reload and new session, backfill of
  tool rows into a copy that lost them; kills only its own server mid-import, repeats the import without duplicates; a
  requested compaction is refused while the bot is fail-closed.
- `bun run check:checkpoint`: a temporary bot whose profile compacts at 90,000 tokens: (1) the agent's own compaction
  of some 270,000 characters runs only after a review in passes, which saves a fact from the first message; (2) a
  deploy-like restart of the check's server (SIGTERM, back 5 seconds later) during the turn that compacts only pauses
  it; (3) the server down past the adapter's 90 seconds stops that turn, and after it is back the conversation holds
  exactly one line in LilBot's words and nothing of Hermes' text, and the message sent again is answered and compacts
  with the save; (4) with a review model that does not exist the turn stops live with `failure: memory_save`; (5) the
  gateway's hygiene pre-pass (forced by a low message limit on that profile) saves first too. Prints seconds, passes
  and review tokens.
- `bun run check:threads`: a temporary bot hands work to another with `lilbot_delegate` and the answer returns; a
  receiver hands it on to a third from its hidden session; the engine API's legacy `threads/ask` still answers
  idempotently, with its limits.
- `bun run check:delegation`: a temporary lead hands two tasks to two helpers in one call, one with a file; then it
  reads their status, redirects one mid-command and stops the other; the first answer returns once, with a file.
- `bun run check:groups`: on a dev server with the round limit at 3, a temporary lead starts a group with two members
  and a file; both reply at once; LilBot is killed mid-round 2 and restarted (the member's gated script ran once); the
  member attaches a file, the lead closes and keeps it (Library, archive, journal facts) and the outcome reaches its
  conversation; a second group is stopped by Oscar; a third ends by itself at the round limit. Nothing is delivered
  twice.
- `bun run check:work`: a temporary bot asked for a small real task opens an item, defines done, adds evidence and
  finishes it (seen in `work.list`); done without evidence is refused by the bot's attempt, and a direct call with its
  key, which no session made, is refused too; a task it hands to a second bot inside an item becomes that bot's child
  item, which the helper finishes.
- `bun run check:work-drop`: two temporary bots, with the dev server SIGKILLed right after a drop and after an answer.
  Oscar drops an item mid-work: its turn ends, the bot is told once and says so. Dropping a parent drops the child and
  stops its exchange as Oscar. Oscar answers the child's question: the helper continues in the exchange and the lead
  gets the outcome once in its own conversation; the lead reads the question and answer with `lilbot_work_list`.
- `bun run check:checks`: a `lilbot_work` call no session made is refused. With one temporary bot (review model Haiku),
  a true level 2 claim is verified by a fresh hidden session of the same bot (recorded as a same-bot check on the
  review model, which Hermes confirms the session ran on, outside the history), whose verdict reuses the request id the
  owner finished with; what that session sent the model has no memory block and its tools no memory, while the owner's
  turn had the planted fact. A false one (the file changes after the owner finishes) comes back not verified with what
  the checker saw, returns to the owner, then waits for Oscar. With a second bot, that bot checks instead, without
  memory too.
- `bun run check:goals`: a temporary bot told in chat to grow `notes.txt` in its folder to 10 lines proposes a goal
  with a baseline read from the file; nothing exists for it before `goals.agree`; after it, the review routine (90 s
  through the routine test override, not one of the bot's five) and goal work items appear; the first review is a
  `figure` item from the routine run with the reading as evidence, checked against the file by a fresh session of the
  same bot; a met goal is reached once that check is done.
- `bun run check:routines`: create from chat, a real file-writing run, open history, pause, restart, resume, delete.
- `bun run check:webhooks`: a dev server with its own helper door on loopback and a temporary bot whose webhook is made
  through its MCP tool: a signed event wakes it; a repeat, an unsigned and a wrongly signed event do nothing. The
  narrow run reads a file in its folder, finishes a work item, asks Oscar a question and leaves its bot a message; its
  tries at `lilbot_bot_create`, `computer_exec`, `lilbot_about` and `lilbot_work_list` with `mine: false` are refused
  (no bot, no change logged, no computer request); unreported direct calls are refused during and after the run; its
  session's real tools (`session.info`, `tools.show`) lack the web, shell, file writes, memory and T3. After it ends
  (`webhook-session-checks.ts`): a skill write and the computers naming its session are refused, Oscar's answer reaches
  the main conversation and the run's transcript does not grow, its message is a line with no turn until Oscar writes,
  his next message passes its own tool call and gives the bot the message, and the review queue never holds it; no
  skill is written meanwhile. Given `web`, `shell` and `coding`, a run gains exactly those, its stored `web_extract`
  output holds the fetched page, and it cannot change the first run's item. A burst of three is one run; pause refuses,
  resume accepts, delete ends the address.
- `bun run check:restart`: SIGKILLs only its own second server mid-turn; chat, routine and thread side-effect counters
  must stay at one. Confirms its profiles are gone with `hermes profile list`. Then `restart-session-check.ts`: two
  deploy-like restarts (SIGTERM, 30 seconds away), one with a changed tool list, an empty session another client opens
  in the bot's profile and a second device; the same engine session continues, the bot still knows what it was told and
  no divider appears.
- `bun run check:attachments`: a generated PNG, a text file, oversize refusal, the live metadata event, reload and
  byte-identical image reopening.
- `bun run check:skills`: skill use, per-bot exclusion and authored writes, then the Hermes engine switch off and on
  against the bot's real system prompt (Hermes builds it on a session's first turn, so each read runs one trivial
  turn).
- `bun run check:computers`, `bun run check:access`: see [computers.md](computers.md) and Listeners in `AGENTS.md`.
- `bun run check:add-computer`: on a dev server, builds the Linux downloads, downloads one, opens the helper under a
  throwaway HOME with a stub service manager, refuses a wrong origin, hands the code over on loopback and sees the
  computer online.
- `bun run check:deploy`: temporary clone, release root, data and systemd units, and one temporary `dev-` profile bound
  in its database whose memory save flag the rollback must clear; see [deploy.md](deploy.md).
- `bun run check:system`: on the dev server, a temporary bot whose instructions never mention LilBot answers what it
  runs in, which version and how it would change LilBot, then pins another bot and creates one through its `lilbot_*`
  tools; checks the roster push, the change log and that an unchanged restart applies nothing.
- `bun run check:my-computer`: on the dev server, two test computers (real helpers under throwaway homes) and a
  temporary bot: a message from a device linked to one runs on it, from a device with no computer on the main one, with
  no main computer the bot asks and lists both, and with the linked computer offline it runs nothing elsewhere; what
  ran where is read from the server's request table, and `chat.history` rows carry their device.
- `bun run check:connections`: a temporary bot on a dev server with the Access door on local test keys and two
  throwaway loopback MCP services (one with its own OAuth server): connected at once and used next message; the sign-in
  link completed through the Access route; no Access login, a wrong state, a reused and a late callback refused;
  refresh; `sign_in_expired` repaired by pasting the final address; `unreachable`; removal takes the tools away; one
  session throughout; the tokens found only in the store.
- `bun run check:coding -- --code-file <file>` (or the code on stdin): needs a fresh pairing code; signs in, checks the
  signed-out, expired and refused messages, a repeated launch and a real task, then archives its threads, removes its
  project and profile and revokes its sign-in.
- `bun live-checks/permissions-check.ts`: repairs a temporary profile from manual approvals to off, runs a harmless
  recursive delete and file write, and checks no approvals remain.
- `bun live-checks/library-check.ts`: a temporary bot told only to deliver a file gives it through `lilbot_give_file`
  (a `system_changes` row names the item), then push, list, separate workspace and download; then a routine run it
  created gives a file from its hidden session and the item records that run.
