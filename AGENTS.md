# LilBot

Read `~/code/home/AGENTS.md` first (machine roles, shared rules). This file holds only what is specific to this repo.

## What this is

Oscar's own bot app, in the style of Grok Bot: one place to chat with and manage his bots. Single user. Runs on the
leader. Hermes is the engine: LilBot never runs a model or an agent loop, it is a client of the Hermes gateway.

North stars: Anthropic's "Building always-on agents" (inbox, timers, memory, permissions, outbox) and DeepSeek
Harness's "Super-agent" post (router and workers, event-driven, watchdog). Use what Hermes already provides for these
before writing our own.

## Project map

Read this first. The app is built around the bot, so the same three names appear on every side: `bots`, `chat`
(still inside `bots` on the server) and `memory`.

```
shared/            What the server and the web app agree on. Definitions only, no logic.
  bot-schema.ts      what a bot is          chat-schema.ts   what a chat and its events are
  memory-schema.ts   what a fact is         protocol.ts      every request the web app can make
  avatar.ts          avatar shapes and colours

server/            The LilBot server (runs on the leader).
  main.ts            Start-up: reads settings, connects the parts below, starts listening.
  http/              How the outside reaches the server.
    browser-session.ts   one connected browser: checks each request and runs it
    socket-guard.ts      who may connect
    engine-api.ts        the local door engines use to reach memory
  bots/              The bot.
    bot-service.ts       everything the app can do with a bot (list, create, open its chat, ...)
    bot-prefs-store.ts   the user's own settings for a bot (avatar, section, pinned, main chat)
    workspaces.ts        each bot's folder
  memory/            The memory system. Works the same for any engine.
    memory-service.ts    the rules        memory-store.ts    the facts table
    memory-safety.ts     what may not be saved
    memory-reviewer.ts   the after-chat review        review-queue.ts   turns waiting for it
  database/          LilBot's own SQLite file and its schema steps.
  engines/           Whatever actually runs the bots.
    bot-engine.ts        the contract every engine must fulfil
    hermes/              the Hermes engine: the only place that knows Hermes exists
      memory-adapter/      the small plug-in Hermes loads to reach LilBot's memory

web/src/           The web app (what you see in the browser).
  app/               start-up, the routes, the connection to the server, styles
  bots/              bot list, create bot, Setup panel
  chat/              the conversation
  memory/            Memory panel
  ui/                shadcn/ui parts (added by the shadcn CLI, ours to edit) and our own small shared
                     parts built from them (panel frame, page header, notice, bot badge, form field)

tests/             Automatic tests, in the same folders as the code they test.
live-checks/       Checks that talk to the real Hermes with a temporary bot.
```

Rules that keep it this way:

- A request flows downward only: `http/` -> `bots/` or `memory/` -> `engines/` and `database/`. Nothing lower may
  import from something higher.
- Nothing outside `server/engines/hermes/` knows about Hermes, except `main.ts`, which picks the engine. A second
  engine is a second folder under `server/engines/`.
- A new feature gets its own folder name, used on every side (`server/<feature>/`, `web/src/<feature>/`,
  `shared/<feature>-schema.ts`, `tests/<feature>/`).
- A new client (desktop, iOS) is a new top-level folder beside `web/` that uses `shared/`.
- Files stay under about 200 lines and are named for what they do.
- `tests/structure.test.ts` fails when an import breaks these rules.

## Status

Foundation done (slice 3): LilBot's own SQLite database for the user's data, a workspace folder per bot, one main
conversation per bot that is the same on every device, and the layout groundwork (chat stays open beside a details
panel, the server pushes roster changes). On top of slice 2: bot list, create bot, the Setup panel (name, function,
instructions, model, workspace, abilities read-only), chat with live tool rows, stop, and starting a new session.
Memory (slice 4): LilBot's own memory system with a Memory panel; new bots use it from their first session, an
existing bot is connected from its Memory panel. Hermes' default bot (Chief of Staff) is a test bot Oscar does not
use: nothing about it needs protecting.
It includes an after-chat review that saves what a chat missed. The user can choose a primary bot in Setup; it
appears first in the roster and its conversation opens on app entry.
Next: the Grok Bot style roster and details panel (sections, pin, hide, avatars, unread, Activity and Library
tabs), the nightly memory tidy-up, delete a bot, edit abilities, routines.
Desktop (Tauri) and iOS (Expo) come after the web app. Approvals are off in Hermes by Oscar's choice, so there are
no approval cards.

## Stack

TypeScript on Bun. No Effect, no server web framework, no ORM. Oscar does not write code: optimise for agents and
for behaviour he can check in the app. Keep an eye on speed and memory; measure before optimising.

- Server: plain `Bun.serve`. Database, when first needed: `bun:sqlite` directly.
- Web: React + Vite, TanStack Router, Tailwind 4, Zustand, Zod. The UI is built on shadcn/ui (Base UI variant,
  `components.json`) and its AI Elements patterns. How UI parts are added:
  - Never hand-write a part shadcn has (button, input, menu, dialog, ...). Add it with
    `bunx shadcn@latest add <name>`; it lands in `web/src/ui/` (alias `@/ui`). Then run `bun run format`. Delete
    exports nothing uses so the file stays under about 200 lines. The code is ours: edit it when needed.
  - A chat feature first looks for its AI Elements pattern: read
    `https://ui.shadcn.com/docs/ai-elements/base/<name>.md` (Chat, Message, Prompt Input, Tool, Task, Queue, Model
    Selector, ...), add the parts it lists, and compose them in the feature's folder. Patterns take plain props:
    map our own data to them at the component edge (`chat/chat-item.tsx`), never reshape `chat-state.ts` or
    `shared/` for a library, and never add the Vercel AI SDK. Next to adopt, when their feature exists: Context,
    File Tree, Confirmation, Subagent, Plan, Sources.
  - Colours: only shadcn's token names (`bg-background`, `bg-card`, `bg-muted`, `text-muted-foreground`,
    `bg-primary`, `text-destructive`, `border`), plus `success` for green. They are defined once in
    `app/styles.css` with LilBot's palette; dark mode follows the device (`prefers-color-scheme`).
  - Feature code imports parts as `@/ui/<part>`. Pages with forms and menus are lazy routes in `app/router.tsx`, so
    the chat's first load stays small (about 205 kB of JavaScript and 14 kB of styles, compressed).
- Checks: Biome, `tsc`, `bun test`, Vite build, all through `bun run verify`. `bun run check:live` is the live
  check against the running Hermes.

## How it works

- `shared/`: LilBot's own definitions, used by server and web. `bot-schema.ts` (Bot), `chat-schema.ts` (chat items
  and events), `protocol.ts` (the browser-server methods, checked with Zod on the server).
- `server/engines/bot-engine.ts`: the interface an engine must satisfy. Nothing outside `server/engines/hermes/` may
  know about Hermes, so another engine (for example one speaking ACP) can be added without touching the web app.
  The one exception is `server/main.ts`, which picks the engine.
- `server/engines/hermes/`: Hermes as the engine. A bot is a Hermes profile (the bot id is the profile id; LilBot's
  display name is stored in the profile's `ui_meta.lilbot`). A chat is a Hermes session. Bot management uses one
  shared gateway connection on the default profile; each open chat has its own connection for its bot's profile,
  because Hermes binds sessions to the profile the connection was attached with (checked live: another profile's
  session is refused with `profile_mismatch`). Sessions use Hermes' canonical methods (`x-canonical-methods` in
  the contract); profiles and models use the general `methods` table. Each connection starts with a
  single-use ticket from `hermes gateway attach --json` (about one second, the slowest step in opening a chat).
- `server/bots/bot-service.ts`: what LilBot does with bots, whichever client asks. It joins the three owners of a bot:
  the engine (identity, setup, chats), the user's preferences (`server/bots/bot-prefs-store.ts`) and the bot's workspace folder
  (`server/bots/workspaces.ts`). It decides which chat is a bot's main conversation and resolves the user's primary
  bot. Layers, top to bottom:
  `http/browser-session.ts` (transport) -> `bots/bot-service.ts` -> engine and stores. Keep it that way.
- `server/http/browser-session.ts`: one per browser connection. Validates requests, runs them on the service, forwards
  chat events. A typed handler map: a protocol method without a handler does not compile.
- `server/database/`: LilBot's own SQLite database (`bun:sqlite`), by default `~/.local/share/lilbot/lilbot.db`
  (`LILBOT_DATA_DIR`). It holds only what belongs to LilBot and the user: sidebar preferences, sections, and each
  bot's main-conversation pointer, plus the single primary-bot choice. Never copy into it what the engine stores.
  `database.ts` owns the schema as an
  ordered list of migration steps (add a step, never edit a shipped one); each store file owns the SQL of its tables.
- Workspaces: one folder per bot under `~/lilbot/workspaces/<bot id>` (`LILBOT_WORKSPACES_DIR`), created on first use
  and passed to the engine as the working directory of new chats. A resumed chat keeps the folder it was made with.
- The server pushes `bots.changed` to every connected browser when a bot, a preference or a section changes, or
  when Hermes reports that sessions or skills changed. Browsers answer by fetching the bot list again.
- `server/activity/` owns live per-session status and durable per-bot unread. `bots.list` includes `activity`
  (status, text, machine, unread); `bots.changed` pushes changes. `activity.setUnread` sets unread manually.
  Opening a chat marks its bot read, and any connected viewer keeps it read until the chat closes.
  Finished/failed statuses settle after eight seconds. The Hermes adapter rotates one observer socket
  across profiles, reading visible live sessions and replay events without resuming them. Hidden memory
  reviews are excluded. Replay cursors prevent old replies becoming unread again after restart.
  `LILBOT_BOT_IDS` restricts the engine to a comma-separated allowlist for isolated test servers.
- `server/http/socket-guard.ts`: who may open the socket (allowed Host names plus same-origin). The tailnet name is set
  in the service's `LILBOT_ALLOWED_HOSTS`, not in code.
- `web/`: `app/` (start-up, routes, the connection `lilbot-socket.ts`, styles), `bots/` (store, sidebar, form, create page, Setup panel), `chat/` (pure
  state in `chat-state.ts`, per-bot store in `chat-store.ts`, lifecycle in `use-chat.ts`, the chat column),
  `memory/` (the Memory panel). `/bots/$botId` is a layout route: the chat column stays mounted and
  connected while panel routes under it (`setup`, `memory`) open and close. Panels use `ui/panel.tsx`. Add new panels as child routes. On a phone an open panel covers the chat.
- The conversation uses AI Elements' Message Scroller: it opens at its latest message (also after a reload or
  resume); a sent message moves up and the reply grows below it (Oscar's choice); the list follows the reply only
  while the reader stays at the end. Only messages sent while the list is open are scroll anchors: the scroller jumps
  to any anchor it did not see arrive (`chat/scroll-anchors.ts`). Earlier items are memoised (`chat/chat-item.tsx`), so a streamed chunk redraws
  only the last one. Queued messages show as dashed bubbles, the activity line as a shimmering Trace line (not
  Reasoning: we get a status, not thinking text), tool use as Trace lines.
- Hermes' wire contract lives in `~/.hermes/hermes-agent/apps/shared/src/gateway-contract.openrpc.json` and
  `tui_gateway/contracts/`. Read it before using a new method, and read only fields the contract declares (Hermes
  sends some undeclared extras; do not rely on them). Every method, parameter and field LilBot uses is listed in
  `tests/engines/hermes/hermes-contract.test.ts`: add to it when you use a new one. It is Hermes' internal API: after every Hermes
  update run `bun run verify` and `bun run check:live`.
- Runs as the systemd user unit `lilbot.service` on `127.0.0.1:3370`. Other devices reach it over the tailnet only
  (port 8443).

## Foundation model

What a bot is and who owns each part. Decided with Oscar on 2026-11-16 unless marked proposed.

| Part | Owner | Where it lives |
|---|---|---|
| Identity (name, function), instructions, model, abilities | the engine | Hermes profile |
| Workspace: one folder per bot on the shared computer | the bot | `~/lilbot/workspaces/<bot id>`, the working directory of its chats |
| Conversation: one main conversation per bot; a new session replaces it as the main one | the engine | Hermes sessions; LilBot's database names the main one |
| Memory | LilBot | facts in LilBot's database; the engine reads and writes them through an adapter |
| Primary bot, avatar, section, pinned, hidden, unread | the user | LilBot's own SQLite database |

- A bot has no type, role or template. Its `function` is a short roster description, not a category.
- Instructions define what makes bots different; every bot has the same skills and tools by default.
- The user chooses one primary bot and can still talk to any bot directly. The choice lives in LilBot's
  database, defaults to the engine's default bot, and falls back to that bot if the chosen one disappears.
  Changing it only moves the mark. The roster puts it first; app entry opens its conversation. Handoff
  between bots and extra knowledge for the primary bot are not decided.
- "Workspace" means exactly this: each bot has its own folder on the shared computer. It is not a level above bots.
  All bots share one machine (the leader); other machines come later as execution environments.
- Long conversations are the engine's job, and Hermes already does it: it compresses the conversation
  automatically at 50% of the model's context (silently, with a separate model), loads the two memory files into
  every run (about 800 and 500 tokens), reminds the bot to save memories every 10 user turns, and runs a background
  review that writes memories and skills. LilBot builds none of this; it shows it and lets Oscar edit it.
- Sidebar state belongs to the user, not the bot: pin, section, read/unread and hide are independent settings.
- A bot's live state (running, writing, waiting, current activity) is separate from unread and from the health of
  its computer.

## Memory

LilBot owns memory so it survives an engine change, can be shared between bots, and can be seen and corrected by
Oscar. Three layers:

1. `server/memory/memory-store.ts`: the `memory_facts` table and its full-text index. A fact has a kind (`profile`
   = lasting, `journal` = dated history), a scope (`bot` = only the bot that learned it, `shared` = all bots), an
   author (bot or user) and dates. "Forget" marks a fact; it is never erased, so history stays reviewable.
2. `server/memory/memory-service.ts`: the rules, engine-neutral and fully unit-tested. Default scope (profile facts
   are shared, journal entries stay with the bot; either can be overridden), who sees what, de-duplication, recall
   by search, and `contextBlock`: what a bot is shown before each turn (lasting facts, then its last 10 journal
   entries, within about 1,500 tokens; the rest is reachable by recall).
3. The engine adapter. `server/http/engine-api.ts` is a local HTTP endpoint (`/engine/memory/*`) for adapters on this
   machine: loopback only, no browsers, token from `<data dir>/engine-token`. The Hermes adapter is a memory
   provider plug-in in `server/engines/hermes/memory-adapter/` (Python, standard library only). It holds no data. It puts
   the usage rules in the system prompt (static, so prompt caching holds), supplies the memory block once per turn,
   and gives the bot two tools: `recall_memory` and `update_memory` (write or forget one fact).

Connecting a bot (`BotEngine.connectMemory`, Hermes: `hermes-memory-setup.ts`) copies the plug-in into the profile,
selects it, and switches Hermes' own `MEMORY.md`/`USER.md` memory off so the bot has one memory. The notes Hermes
held are kept: what it knew about the user becomes shared facts; a bot's own notes become its private facts (only
for an existing bot, not for a new one, which starts as a copy of the main bot). It takes effect from the bot's
next session. `removeMemory` undoes it.

The plug-in's instructions carry the saving rules, taken from Hermes' own memory code where they were written
after real failures: save only what is grounded in the conversation, never infer traits, a one-off request is not a
standing preference, one fact goes in once, and a list of what not to save (secrets, anything that can be looked
up, task progress, "tool X is broken"). `server/memory/memory-safety.ts` refuses facts that carry instructions for
the model, secrets or invisible characters, for bots and for the user. A write tells the bot when it holds more
lasting facts than it is shown, so it tidies. Hermes fences what a provider supplies as "recalled memory, not new
user input" on its own.

Hermes keeps a plug-in's code loaded per folder until the gateway restarts. So each version is installed under its
own folder and provider name (`lilbot-memory-v0-3-0`): a new version is a new folder, loaded fresh on the bot's next
session. To ship a plug-in change: bump `version` in `plugin.yaml` and `VERSION` in `__init__.py`, and restart
LilBot. At start-up `BotEngine.refreshMemory` reinstalls the adapter for every connected bot on an older version.
No Hermes restart is needed. LilBot logs a warning when a bot still calls with an older adapter.

### The after-chat review

A bot saves what it notices during a chat; the review catches what it missed. Hermes' own background review only
runs with Hermes' built-in memory tool, which a connected bot no longer has, so LilBot has its own.

- The plug-in hands every finished turn of a real conversation to `/engine/memory/turn` (`sync_turn`, on a thread;
  not for scheduled runs or sub-agents). `server/memory/review-queue.ts` keeps them only until reviewed.
- `server/memory/memory-reviewer.ts` checks every 20 seconds and reviews a bot once 10 turns wait, or once at
  least 3 wait and the chat has been quiet for 2 minutes. `LILBOT_REVIEW=off`, `LILBOT_REVIEW_TURNS` and
  `LILBOT_REVIEW_QUIET_SECONDS` change that.
- If the engine reports a missing bot, its queued turns are discarded once. Other review failures retry after 10 minutes.
- LilBot runs no model. `BotEngine.reviewMemory` runs the review as a hidden session of the same bot with only its
  memory tools, on `LILBOT_REVIEW_MODEL` (`provider::model`; without it, the bot's own model, which costs more).
  Limiting the session to memory tools cuts its prompt from about 26,000 tokens to about 4,500.
- A review follows stricter rules than a chat: it may not bring back a fact the user removed, and may not forget a
  fact the user wrote. Its own session is never queued for review. What it saves is marked `via: review`.
- No approval step, by Oscar's decision: found facts apply at once. The Memory panel shows where each fact came
  from and lets him pause, forget and restore.

Measured on 2026-11-16 (`bun run check:memory`, 21 checks): a fact told in one session was known in the next from
the block alone; a correction replaced the old fact; a one-off request was not saved; a review on Sonnet 5.5 took
about 8 seconds, saved the lasting fact a chat had missed and skipped a one-off request and a temporary failure. A
turn sent about 29,700 tokens with LilBot memory against 31,600 with Hermes' own; one review sends about 12,000 in
total. The check reads the bot's real system prompt for the rules: asking a bot to describe its own instructions
proved unreliable.

A fact can be paused (kept, not shown to bots), forgotten and restored, and can carry an expiry date
(`update_memory` takes `expires`). Each fact records how it arrived (`via`: chat, review, app, import) and the chat
it came from.

Learned from other systems (reports in `~/agent-tmp/memory-study/`; nightly-labs' OpenBot is noncommercial-licensed:
ideas only, never its code): Hermes (the saving rules, the safety scan), OpenMausBot (review on quiet time as well
as turn count, not re-learning what the user removed, restore), nightly-labs OpenBot (a review limited to memory
operations on a cheaper model, protecting what the user wrote), CopilotKit OpenBot (pause, provenance).

Not built yet: the nightly tidy-up (merge duplicates, drop outdated facts), attaching facts relevant to the
user's message automatically, holding a turn's writes until the turn succeeds, and saving before Hermes compresses
a conversation (`on_pre_compress`).

## What Grok Bot does (reference, not a spec)

Studied on 2026-11-16 from the app's code (1.0.1) and screenshots (1.1.0). Reports: `~/agent-tmp/grokbot-findings.md`,
`~/agent-tmp/grokbot-ui-ref/`, and Oscar's `~/code/Grokbot-cli/docs/`. Copy structure and behaviour, never its
artwork, names or text.

- Layout: bot roster left (main bot pinned on top, named sections, latest-message preview, unread dot), one ongoing
  conversation in the middle, a details panel on the right (Activity: routines, suggestions, computer, voice;
  Library: pages, media and files, newest first, tabs only when there is more than one kind).
- Bot menu: pin, move to section, mark unread, rename, copy conversation id, hide, delete. The main bot instead has
  unpin and "replace with a different bot", which only changes which bot is the main one.
- Create bot: name, avatar shape and colour, nothing else. A one-time id makes a retry safe. A typed first message
  replaces the bot's automatic introduction.
- Avatars: a fixed set of shapes and colours; a missing choice falls back to one derived from the bot's id.
- Status line: mostly built by the app from the tool in use ("Searching the web", "Running commands"), plus a
  status text the bot can set itself. A finished or failed turn shows for 8 seconds, then idle.
- Memory shape: a profile text, dated journal entries, and facts with a learned-at time.
- Asked of Oscar's two test bots on 2026-11-16 (their own account unless marked observed; report in
  `~/agent-tmp/grokbot-live-research/FINDINGS.md`):
  - Workspace: every bot works in the same shared folder (`/workspace`) on one 128 GB machine, and one bot can list
    another's folder. Each bot also has a small private folder (profile, settings, attachments, assets, a store).
    Skills live in one shared folder. So Grok Bot shares files between bots by default; LilBot's folder per bot is a
    deliberate difference.
  - Memory: four kinds, `profile` (lasting facts about the user and how to work with them), `journal` (dated
    history, latest entries shown), and a shared version of each that every bot of the user sees, tagged with the
    bot that learned it. The profile facts are put into every turn; older ones are fetched by a recall tool
    (query, limit, kind). Writes are `write` or `forget` of one fact; a correction is forget then write.
  - Long conversations: the full transcript is kept (observed: 458 rows, all still readable, no reset), while the
    model sees a structured summary of older turns followed by the recent ones, and can search old turns with a
    tool. The trigger and limits are unknown.
  - Live state (observed): running, thinking, a tool activity with a short detail text, composing, then a settled
    result. The status text is produced by a status tool the bots themselves say they do not have.
- Still unknown: compaction thresholds, background memory tidy-up, where memory is stored.

## Known gaps

- Activity observation uses a rotating profile-bound Hermes socket (about one second per attach plus a one-second sweep delay); very short activity may only be seen at completion. Hermes live listings expose at most 200 sessions per profile. A future host-scoped subscription could reduce latency.
- Opening a chat loads its whole history. A long-lived conversation needs paging and stable item ids
  (Hermes: `omit_messages` on resume plus `session.transcript`).
- A bot's display name is still stored on the Hermes profile (`ui_meta.lilbot.name`), written as one whole value.
  Nothing else may be added there; the user's data goes in the database.
- Deleting a bot is not in the app. When it is added: refuse the default bot, delete through the engine, call
  `BotPrefsStore.forgetBot`, and decide with Oscar whether the workspace folder is kept.
- Chats made before slice 3 are not a bot's main conversation; they are still in Hermes.

## Rules

- Do not fork or patch Hermes. Configure it, or build on its API.
- The attach ticket and anything under `~/.hermes` that holds credentials are never printed, logged or committed.
- Test on a second server (`LILBOT_PORT=3371 LILBOT_DATA_DIR=<tmp> LILBOT_WORKSPACES_DIR=<tmp> bun server/main.ts`)
  with temporary bots, never Oscar's real bots, and
  delete them afterwards with `hermes profile delete <id> -y`.
- Each slice ends with a real check against the running service: `bun run verify`, `bun run check:live`, then drive
  the page in a browser.
- Logic that can be tested without a browser or Hermes gets a test in `tests/` in the same change.
- Keep docs in this file. Replace outdated text; do not append history.

## Issues and labels

Work is tracked as GitHub issues on this repo, split across threads: a discussion thread files backend issues, an
orchestrator builds them, and a separate UI thread prototypes screens. The discussion thread does not talk about
layout, so the labels say whether a screen still has to be designed.

- One issue per agreed decision. A part of an issue marked "proposed, not confirmed by Oscar" is checked with him
  in that issue before anyone relies on it.
- `backend`: server, data and engine work. The issue describes the data and the API, never the layout.
- `ui`: screens. Designed in the UI prototype thread.
- `spike`: investigate and report before building.
- `needs-ui`: a note that this feature has a screen nobody has designed yet.

How `needs-ui` works:

- It is a note, not a blocker. A `backend` issue with `needs-ui` is built and closed as normal, without waiting for
  a prototype.
- Closing the issue does not remove the label. Whoever builds or closes a backend issue leaves `needs-ui` on it.
- Only the UI thread removes it. It finds the screens waiting for a prototype by listing the label across open and
  closed issues: `gh issue list --label needs-ui --state all`.
- For each one, the UI thread prototypes the screen, opens a `ui` issue that links to the backend issue, and then
  removes `needs-ui` from the backend issue.
- A backend issue must not stay open only because its screen is missing. If its backend part is done and merged,
  close it once the prototype exists and the `ui` issue that will build the screen has been created and linked. The
  remaining work lives in the `ui` issue.
- So `needs-ui` on an issue, open or closed, means "no prototype yet". No `needs-ui` means "no screen, or a linked
  `ui` issue exists".

Cleaning up after a merge:

- The agent that merges a PR also removes what it used: its t3 worktree, its local branch and its remote branch.
  With squash merges git reports the branch as unmerged; delete it once the PR shows as merged.
- Remove only your own worktree and branch. Another thread's unmerged work stays.
- A branch whose PR was abandoned is removed the same way, after saying so in the issue.

## Commands

- `bun run verify`: lint, typecheck, unit and contract tests, and build the web app into `dist/`. `bun run format`
  applies formatting.
- `bun run check:live`: creates a uniquely named temporary bot in Hermes, connects it to a throwaway memory endpoint,
  chats, stops, resumes, then deletes it. A few model calls.
- `bun run check:memory`: connects a temporary bot to a throwaway memory, tells it facts, checks a new session knows
  them, prints tokens per turn, then deletes it. Inherited memory is disconnected before the baseline turn. A few model calls.
- `bun run start`: run the server. `LILBOT_PORT` and `LILBOT_HOST` override the defaults.
- `bun run dev`: Vite with hot reload, proxying `/ws` to a server on 3370.
- After a change: `bun run verify && systemctl --user restart lilbot.service`.
