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
    bot-store.ts         identity, instructions, model and engine binding (SQLite)
    bot-prefs-store.ts   the user's own settings for a bot (avatar, section, pinned, main chat)
    workspaces.ts        each bot's folder
  memory/            The memory system. Works the same for any engine.
    memory-service.ts    the rules        memory-store.ts    the facts table
    memory-safety.ts     what may not be saved
    memory-reviewer.ts   the after-chat review        review-queue.ts   turns waiting for it
  threads/           shared bot exchanges, transcripts and durable deliveries
  routines/          app-owned schedules, run history and scheduler
  library/           Delivered workspace files, metadata, safe reads and folder listings.
  attachments/       Incoming chat files, streaming uploads and durable message associations.
  history/           Conversation records, import checkpoints, paging and bot-scoped search.
  connections/       LilBot-owned connections given to every bot: T3 Code for coding (bridge, sign-in, skill).
  computers/         Computer identities, key registration and durable command requests.
  database/          LilBot's own SQLite file and its schema steps.
  deploy/            verified restart, database copies, rollback watchdog and notices.
  engines/           Whatever actually runs the bots.
    bot-engine.ts        the contract every engine must fulfil
    hermes/              the Hermes engine: the only place that knows Hermes exists
      memory-adapter/      the small plug-in Hermes loads to reach LilBot's memory

web/src/           The web app (what you see in the browser).
  app/               start-up, the routes, the connection to the server, styles
  bots/              roster, bot menu and its dialogs, create bot, details panel and its Setup tab
  chat/              the conversation
  attachments/       files in the composer and in sent messages, the drop area
  activity/          the details panel's Activity tab
  library/           the Library tab (placeholder until #14)
  memory/            the Memory tab
  routines/          data client for the future Routines panel
  deploy/            last deployment failure notice
  settings/          the Settings dialog (delete defaults)
  ui/                shadcn/ui parts (added by the shadcn CLI, ours to edit) and our own small shared
                     parts built from them (tab body, page header, icon button, notice, bot badge, form field)

tests/             Automatic tests, in the same folders as the code they test.
live-checks/       Checks that talk to the real Hermes with a temporary bot.
```

Rules that keep it this way:

- A request flows downward only: `http/` -> `bots/`, `memory/`, `routines/`, `threads/`, `attachments/` or `library/` -> `engines/` and `database/`. Nothing lower may
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
existing bot is connected from its Memory panel. Hermes' default bot (Chief of Staff) is Oscar's live bot. Never use it for agent tests.
It includes an after-chat review that saves what a chat missed. The user can choose a primary bot in Setup; it
appears first in the roster and its conversation opens on app entry.
The primary bot can create bots when asked, using `create_bot`. LilBot authenticates the caller with a
bot-bound capability in its adapter settings, checks the current primary, and ignores caller ids and
models in tool arguments. The primary writes the instructions and function; the new bot inherits its
model. Request ids prevent duplicate creation, including concurrent retries and server restarts.
The bot appears immediately; a hidden first prompt starts its main conversation with its own greeting
and task suggestions. Normal activity observation marks that reply unread. The primary returns a link.
The app's create form stays available.
The app shell is three columns (#36): roster, conversation, details panel with Activity, Library, Memory and Setup
tabs. The bot menu, delete confirmation and Settings are built (#37). Next: the Routines and Library screens, the nightly memory
tidy-up and edit abilities.
Desktop (Tauri) and iOS (Expo) come after the web app. Each bot defaults to full access; LilBot verifies
and repairs its Hermes profile's approvals-off setting on startup and before use. There are no approval cards.

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
    `bg-primary`, `text-destructive`, `border`), plus `success` for green and `hairline` (foreground at 8%) for the
    line between columns and around cards. Other tints are the foreground at an opacity (`bg-foreground/4` hover,
    `/6` pressed). Accent blue (`primary`) is only for the unread dot and the working spinner; switches and primary
    buttons are ink (`bg-foreground`). They are defined once in `app/styles.css` with LilBot's palette; dark mode
    follows the device (`prefers-color-scheme`). Bot replies use the `prose-chat` utility defined there.
  - Type scale, closed: 12 meta and section labels, 13 previews and menus, 14 names, 15 chat text, 16 panel and
    dialog titles. Weights 400, 500, 600. Icons 16px at stroke 1.75 in 28px buttons (`ui/icon-button.ts`).
  - Feature code imports parts as `@/ui/<part>`. Pages with forms are lazy routes in `app/router.tsx` and the
    details tabs are lazy chunks in `bots/bot-details-panel.tsx`, so
    the chat's first load stays small (about 218 kB of JavaScript and 17 kB of styles, gzip -9, counting every
    file `dist/index.html` references; Vite's per-file sizes alone understate it). The bot menu, its dialogs and
    Settings are lazy too: the roster only writes to small stores and loads them on hover or first use. The
    image viewer (`ui/image-viewer.tsx`) loads on the first click on an image.
  - `bun run build` also writes brotli and gzip copies of the text files in `dist/` (`scripts/compress-dist.ts`).
    `server/http/static-files.ts` serves them to every listener that serves the app (private, Access, dev):
    the encoding the browser accepts, `Cache-Control: public, max-age=31536000, immutable` for hashed files under
    `/assets/` (a missing one is a 404, never the page), `no-cache` with an ETag for `index.html` and other files.
    A repeat visit downloads only the page (about 0.6 kB); a first visit about 206 kB instead of 814 kB.
- Checks: Biome, `tsc`, `bun test`, Vite build, all through `bun run verify`. `bun run check:live` is the live
  check against the running Hermes.

## Production and development

Production is Oscar's daily app: `lilbot.service`, port 3370, `~/.local/share/lilbot`,
`~/lilbot/workspaces`, `~/lilbot/skills`, and the existing `~/.hermes` gateway.
Never test against these, restart them as a check, or use any live bot (including Chief of Staff).
Production release folders and deployment are owned by #74. The orchestrator must add
`Environment=LILBOT_ENV=production` to the production unit once; development setup never edits it.

Run `bun run dev:setup` on the leader before live checks. It creates `~/lilbot-dev/` with
`hermes/`, `hermes-locks/`, `data/`, `workspaces/` and `skills/`, and starts the separate
`lilbot-dev-hermes.service`. Both `HERMES_HOME` and `HERMES_GATEWAY_LOCK_DIR` are explicit in that
unit. Setup waits for a ready gateway, preserves existing config/credentials, and is idempotent.
There is no standing dev LilBot instance, network address, or automatic start at login.
Stop the dev gateway when no checks need it with `systemctl --user stop lilbot-dev-hermes.service`.

Dev has an independently written CLIProxy provider config. `~/lilbot-dev/hermes/.env` (0600) contains
only its named client-key variable, loaded via `EnvironmentFile` and inherited by dev profile clones. CLIProxy is on another host;
there is no local key-issuing config, so setup copies only that variable from the production `.env`
once. Calls share the upstream allowance. Never copy the entire `.env`, `auth.json`, MCP tokens,
or production T3 grants. Authorize development T3 separately when needed.

Every live-check entry imports `scripts/dev-env.ts` first, including direct `bun live-checks/...`
runs. It sets `LILBOT_ENV=development`, the dev engine home/locks, loopback/free port and throwaway
app directories under `~/lilbot-dev/runs/`. Checks remove their profiles and folders. Run live checks sequentially: Hermes plugin admission
reads the shared dev profile catalogue while plugins are added or removed. Hermes CLI calls
must pass `env: process.env` explicitly: Bun's default spawn environment can predate the initializer.
`LILBOT_HERMES_BIN` selects the executable consistently; do not update the shared Hermes program to test a change.

Development creates only `dev-` engine profiles and refuses other bindings. Production ignores
`dev-` profiles, including persisted bindings. Development also checks the attach receipt's home
before connecting. `server/environment.ts` rejects production paths/ports/service targets in checks,
and requires all dev directories under the dev home. Production startup refuses test overrides,
including profile allowlists, skipped memory setup, test intervals and local Access certificate URLs.
Server startup requires an explicit `LILBOT_ENV`; use the launcher for checks, never an unconfigured server.

## How it works

- `shared/`: LilBot's own definitions, used by server and web. `bot-schema.ts` (Bot), `chat-schema.ts` (chat items
  and events), `protocol.ts` (the browser-server methods, checked with Zod on the server).
- `server/engines/bot-engine.ts`: the interface an engine must satisfy. Nothing outside `server/engines/hermes/` may
  know about Hermes, so another engine (for example one speaking ACP) can be added without touching the web app.
  The one exception is `server/main.ts`, which picks the engine.
- `server/engines/hermes/`: Hermes as the engine. Each bot has a profile binding; a chat is a Hermes session.
  LilBot supplies instructions, model and permission mode, repairing drift before use; it never writes a display name to the profile.
  Bot management uses one shared gateway connection on the default profile; each open chat has its own connection for its bot's profile,
  because Hermes binds sessions to the profile the connection was attached with (checked live: another profile's
  session is refused with `profile_mismatch`). Sessions use Hermes' canonical methods (`x-canonical-methods` in
  the contract); profiles and models use the general `methods` table. Each connection starts with a
  single-use ticket from `hermes gateway attach --json` (about one second, the slowest step in opening a chat).
  So after a chat opens, `hermes-spare-sockets.ts` attaches one spare connection for that profile in the
  background; the bot's next open takes it and skips the attach (about 0.15-0.4 s instead of 1.1-1.8 s). A spare
  holds no session. At most four profiles keep one, each for ten idle minutes; deleting a bot closes its spare.
- `server/bots/bot-service.ts`: what LilBot does with bots, whichever client asks. It joins the three owners of a bot:
  LilBot's identity (`server/bots/bot-store.ts`), the engine (abilities and chats), and the user's preferences
  (`server/bots/bot-prefs-store.ts`), with the bot's workspace folder (`server/bots/workspaces.ts`).
  `bot-runtimes.ts` resolves the engine binding and applies saved identity; runtime availability and abilities are cached at startup and refreshed on creation, updates, memory connection and observed profile disappearance/return. Roster and detail reads use this snapshot without engine calls; `bot-memory.ts` connects memory.
  The first import is atomic and idempotent: existing bots keep their profile ids, so memory, preferences,
  main chats and workspaces need no rewrite. New bots get UUIDs independent of their native runtime ids. A missing runtime stays in the roster
  as unavailable; its identity and memory stay in LilBot. The service decides which chat is a bot's main
  conversation and resolves the user's primary bot. Layers, top to bottom:
  `http/browser-session.ts` (transport) -> `bots/bot-service.ts` -> engine and stores. Keep it that way.
- Deletion: `bots.delete` accepts optional `files: archive | delete` and `privateMemories: forget | keep`.
  `bots.deleteDefaults.get/set` persists defaults (archive and forget) in SQLite. Both the primary and engine
  default bot are protected. `bot-deletion.ts` saves a tombstone with the name and choices before teardown,
  removes the runtime using its native binding, then handles workspace, memory, prefs, activity and queued reviews.
  Deletion clears the creation marker and removes the profile settings that hold its capability and memory binding.
  Deleted capabilities are refused immediately, even if teardown needs a retry; creation retries cannot revive tombstones.
  Retrying the same id finishes incomplete cleanup with its original choices. Tombstones stay out of the roster;
  `memory.list` still exposes their active/forgotten facts for attribution and restoration. Shared facts stay.
  Archived workspace entries move to `<workspaces>/.archive/<bot id>` without following links.
  Hermes has no delete RPC: its profile-delete CLI stops the runtime and deletes its transcripts; a retry after
  folder removal uses `profile purge-identity` to finish gateway identity settlement. Late activity and memory
  calls from deleted bots are ignored/refused. Routines and their run history are removed too. Library metadata is retained for attribution; deleted bots cannot list or fetch it. Webhooks and reports are not built yet.
- `server/http/browser-session.ts`: one per browser connection. Validates requests, runs them on the service, forwards
  chat events. A typed handler map: a protocol method without a handler does not compile.
- `server/database/`: LilBot's own SQLite database (`bun:sqlite`), by default `~/.local/share/lilbot/lilbot.db`
  (`LILBOT_DATA_DIR`). It owns bot identity (name, function, instructions, model), engine/native-id bindings,
  memory, sidebar preferences, sections, main-conversation pointers and the primary-bot choice.
  Tools and MCP connectors stay with the engine, except the T3 Code connection LilBot supplies (see Coding). Skills belong to LilBot. Identity is imported once, then LilBot wins
  on mismatch; model edits are checked against the engine’s available models before anything is saved,
  including when repairing a bot with an invalid saved model. Unsupported permission modes also fail before saving.
  Accepted edits (including name, function and instructions) are saved in the database before they are applied to the runtime.
  `database.ts` owns the schema as an
  ordered list of migration steps (add a step, never edit a shipped one); each store file owns the SQL of its tables.
- Workspaces: one folder per bot under `~/lilbot/workspaces/<bot id>` (`LILBOT_WORKSPACES_DIR`), created on first use
  and passed to the engine as the working directory of new chats. A resumed chat keeps the folder it was made with.
- The server pushes `bots.changed` to every connected browser when a bot, a preference or a section changes, or
  when Hermes reports that sessions or skills changed. Browsers answer by fetching the bot list again.
- `server/activity/` owns live per-session status and durable per-bot unread. `bots.list` includes `activity`
  (status, text, machine, unread); `bots.changed` pushes changes. `activity.setUnread` sets unread manually.
  Opening a chat marks its bot read, and any connected viewer keeps it read until the chat closes.
  Finished/failed statuses settle after eight seconds. The Hermes adapter keeps one persistent observer
  socket per bot, polling in parallel once per second and reconnecting on failure with capped exponential backoff. It reads visible live sessions
  and incremental replay events without resuming them; an epoch change or truncated replay gets one
  full baseline read. Derived session state survives sweeps, and removed profiles release their sockets.
  The watcher enumerates bound bots, connects with native profile ids, and emits activity and replay
  cursors with LilBot ids. Missing profiles and unavailable engines are not observed.
  Hidden memory reviews are excluded. Replay cursors prevent old replies becoming unread again after restart.
  `LILBOT_BOT_IDS` restricts the engine to a comma-separated native-profile allowlist for isolated test servers;
  runtimes created on that server are added to its allowlist. Use `LILBOT_SKIP_MEMORY_SETUP=1` to skip startup
  memory changes to existing profiles.
- `server/http/socket-guard.ts`: who may open the socket (allowed Host names plus same-origin). The tailnet name is set
  in the service's `LILBOT_ALLOWED_HOSTS`, not in code.
- `web/`: `app/` (start-up, routes, the connection `lilbot-socket.ts`, styles), `bots/` (store, roster, form, create
  page, details panel, Setup tab), `chat/` (pure state in `chat-state.ts`, per-bot store in `chat-store.ts`,
  lifecycle in `use-chat.ts`, the chat column), `activity/`, `library/` and `memory/` (their tabs).
- Layout (`app/router.tsx`): on a wide screen three columns. The roster (272px) and details panel (332px) sit on the
  page tint (`bg-background`), the conversation on `bg-card`; a `hairline` divides them. The roster
  (`bots/bot-sidebar.tsx`) has the app icon, search (filters names and functions, hidden bots included) and new bot;
  then the primary bot with a star, the user's sections as 12px labels, and the collapsed "Unassigned" and "Hidden"
  groups with counts (with no sections, bots are listed plainly; the group holding the open bot stays open; open
  groups are remembered per browser). Grouping is `bots/roster-groups.ts`; pinned bots go first in their group.
  A row (52px) shows one line from `bots/row-state.ts`: working (blue spinner and the activity text), "Waiting for
  you", finished (green check), failed (red cross), or, idle, the bot's function (there is no message preview in
  the data yet). Unread rows have a 600 name and a blue dot; on hover the "more" button replaces the dot. The footer shows the user, a Settings
  button and, while the socket is down, "Offline · reconnecting" with a red dot
  (the composer then says "Reconnecting..."). The chat header is one 52px line: name, function, new session and the
  details toggle. Conversation column max 680px: bot text without a bubble (15/24), the user's message in a tinted
  bubble, tool lines 13px, a round composer with a plus button for files and an ink send/stop button (stop while
  the bot works and the box is empty with no files). Attachments are described under "Chat attachments".
- Bot menu (`bots/bot-menu.tsx`, Paper "02 Bot menu"): the row's "more" button or a right-click opens one shared
  menu (208px, 30px rows), anchored at the button or the cursor (`bots/bot-menu-target.ts` holds which bot and which
  dialog). Items: Pin/Unpin, Move to section (the sections with the current one checked, "No section", then "New
  section…", which names a section and moves the bot into it), Mark as read/unread, Name and avatar, Make primary,
  Hide/Show, then Delete…. The primary bot's menu has only Mark as read/unread, Name and avatar and "Change primary
  bot" (a submenu of the other bots; only the mark moves): it always sits on top, so pin, section and hide would
  change nothing, and it cannot be deleted. The engine's default bot has no Delete. Which items show is
  `bots/bot-menu-rules.ts`. A failed action shows a short red note above the roster footer.
- Delete confirmation (`bots/delete-bot-dialog.tsx`, Paper "03 Delete bot"): "Delete <name>?", what goes (the
  conversation and its routines, counted from `routines.list`) and what stays, then Files (Archive / Delete) and
  Private memories (Forget / Keep, with the bot's private fact count) starting from `bots.deleteDefaults.get`, read
  on every open. "Change defaults" closes it and opens Settings on Bots. Deleting the open bot returns to the app's
  start. Server errors show in the dialog. Sentences are `bots/delete-copy.ts`.
- Settings (`settings/settings-dialog.tsx`, Paper "04 Settings"): the roster footer's button opens a 720×480 dialog
  with General, Bots and Memory on the left. Only Bots has settings: "When a bot is deleted", the same two choices,
  saved at once with `bots.deleteDefaults.set`.
- Details panel (`bots/bot-details-panel.tsx`): avatar, name and pill tabs; each tab is the route
  `/bots/$botId/$tab` (`activity`, `library`, `memory`, `setup`), its content a lazy chunk wrapped in `ui/panel.tsx`.
  `/bots/$botId` is a layout route: the chat column stays mounted and connected while tabs open, change and close.
  At 1280px and wider the panel opens on Activity by itself unless the user closed it (remembered per browser);
  opening another bot keeps the open tab. On a phone the panel opens only from the toggle and covers the chat.
  Activity shows the live state (with how long, only when this browser saw it start: `activity/activity-since.ts`),
  a Routines placeholder and the workspace folder (click copies the path; a browser cannot open a server folder).
  To add a tab (Routines #10, Skills #24): an entry in `DETAILS_TABS` (`bots/details-tabs.ts`) and a lazy entry in
  `tabContent`, whose component takes `{ botId }` and wraps its body in `ui/panel.tsx`.
- The conversation uses AI Elements' Message Scroller: it opens at its latest message (also after a reload or
  resume); a sent message moves up and the reply grows below it (Oscar's choice); the list follows the reply only
  while the reader stays at the end. Only messages sent while the list is open are scroll anchors: the scroller jumps
  to any anchor it did not see arrive (`chat/scroll-anchors.ts`). Each transcript load (`ChatView.load`) resets
  which items count as arrived. Rows are memoised (`chat/message-list.tsx`, `chat/chat-item.tsx`), so a streamed
  chunk redraws only the last one, and a reloaded transcript keeps the objects of unchanged items
  (`reuseItems` in `chat/chat-state.ts`), so a reopen redraws nothing. A chat this page has not shown yet appears
  from `chat.history` (a database read) while `chat.open` attaches; the message box takes typing meanwhile and
  sends once the chat is open. The list first draws the latest 20 rows, then the earlier ones in a transition that
  yields to typing; the scroller keeps the view in place as they arrive above. Queued messages show as dashed bubbles, the activity line as a shimmering Trace line (not
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
| Identity (name, function), instructions, model, permission mode, engine binding | LilBot | `bots` table in LilBot's database |
| Skills and per-bot skill switches | LilBot | shared skills library and SQLite |
| Tools and MCP connectors | the engine, except LilBot's T3 Code connection | Hermes profile; the T3 connection is defined in `server/connections/` |
| Workspace: one folder per bot on the shared computer | the bot | `~/lilbot/workspaces/<bot id>`, the working directory of its chats |
| Conversation: continuous history, with one active session | LilBot record; engine working context | SQLite history items and session dividers; Hermes keeps model context |
| Memory | LilBot | facts in LilBot's database; the engine reads and writes them through an adapter |
| Primary bot, avatar, section, pinned, hidden, unread | the user | LilBot's own SQLite database |

- A bot has no type, role or template. Its `function` is a short roster description, not a category.
- Each bot has one permission mode, stored with its identity: `full-access` by default. The protocol names
  `approval-required`, `auto-accept-edits`, `auto` and `full-access`; only full access is supported now.
  Engines declare supported modes, and unsupported choices fail before saving. LilBot applies the mode on
  creation, once per bot at startup, mode changes, chats and reviews. Chat and review checks reuse their profile-bound sockets; list/get reads never prepare permissions. Future routine and webhook runs must use the bot's mode.
  Hermes uses persistent per-profile `approvals.mode: off`, so background runs inherit it too.
  LilBot bots do not follow the home rule requiring approval for App Store Connect or submissions to Apple.
  They may still ask task questions, and engine hard stops remain.
- Instructions define what makes bots different; every bot has the same skills and tools by default.
- The user chooses one primary bot and can still talk to any bot directly. The choice lives in LilBot's
  database, defaults to the engine's default bot, and falls back to that bot if the chosen one disappears.
  Changing it only moves the mark. The roster puts it first; app entry opens its conversation. Bots answer
  whoever gave them the work: Oscar in that chat, another bot in their shared thread. Nothing routes
  to the primary automatically; extra knowledge for the primary is not decided.
- "Workspace" means exactly this: each bot has its own folder on the shared computer. It is not a level above bots.
  All bots share one machine (the leader); other machines come later as execution environments.
- Long conversations are the engine's job, and Hermes already does it: it compresses the conversation
  automatically at 50% of the model's context (silently, with a separate model), loads the two memory files into
  every run (about 800 and 500 tokens), reminds the bot to save memories every 10 user turns, and runs a background
  review that writes memories and skills. LilBot builds none of this; it shows it and lets Oscar edit it.
- Sidebar state belongs to the user, not the bot: pin, section, read/unread and hide are independent settings.
- A bot's live state (running, writing, waiting, current activity) is separate from unread and from the health of
  its computer.

## Conversation history

`server/history/` owns the conversation record (migration **18**). Hermes owns the model's
working context; LilBot never summarises. Streaming chat events are journalled before forwarding; observer replay is journalled by epoch/sequence when no browser is open,
including user sends, tool rows and completion. A read-only background importer reconciles durable
Hermes transcript rows, including work completed while LilBot was offline. Row ids are namespaced
by engine/profile, and repeated pages upsert rather than duplicate. Attachment metadata is merged
at the HTTP edge and copied with its original session; thread references are recorded at the same
edge without indexing the thread's private transcript. Routine and hidden thread/review sessions
are excluded. Deleting a bot removes its conversation record and journal, regardless of file/archive
and private-memory choices, matching #59; those choices continue to govern files and facts.

- `chat.open` / `chat.new` keep their existing snapshot and event shapes. `items` holds the latest
  100 display records (without the new divider kind, for old clients). Additive `history` contains
  `{items, nextCursor, start, import}`. Each history item is `{id, sessionId, at, author, item}`;
  `item` is a normal ChatItem or `{kind:'session', text:'New session'}`. Times are epoch milliseconds.
  The active session id remains `snapshot.chatId`; a new session retains earlier history.
- `chat.history({botId, cursor?, limit?})` returns the same page, with a maximum/default of 100.
  Pages are newest first, records within them chronological. Prepend older pages. Cursors are
  bot-bound sort keys, so new messages do not shift old pages. `start:{at}` appears only on the
  oldest page after import completes; `null` is not a definitive beginning while import is pending.
  `import` reports `complete`, discovered `sessions`, `completed` sessions and `items` count.
  `history.changed {botId}` tells new clients to refresh after background progress.
- The importer does one 100-row page per bot per second, with atomic row/cursor checkpoints.
  First open reads only the latest engine page and resumes with `omit_messages`; startup never
  waits for history. Discovery runs every 30 seconds against both live and stored catalogues.
  Both catalogue APIs cap at 200 without pagination. At that boundary the Hermes adapter reads
  only session metadata from that profile's `state.db` in **read-only** mode, joining compression
  parents; all message content still goes through `session.transcript`. This fallback depends on
  Hermes' session table schema and has a fixture test. Errors leave import pending for retry.
  Empty oldest-order pages retain their tail cursor, so later turns can be copied without rereading
  months of history. Rewinds/resets never erase already copied rows: this is an append-only record.
- Adapter **0.9.0** (`lilbot-memory-v0-9-0`) adds `search_conversations(query,limit?)`. It authenticates
  with the existing bot-bound capability and searches only that bot's user/assistant rows, returning
  snippets, ids, session ids and times plus import progress. Move this tool to #62's hub later.
- `on_pre_compress` synchronously offers the conversation's user/assistant evidence (bounded to the
  last 100,000 characters) to a hidden memory-only review by the same bot, before Hermes summarises.
  It uses the normal memory rules and protections. Review sessions cannot recursively review
  themselves. This uses Hermes' best-effort hook, not the v2 fail-closed checkpoint promise: an
  unavailable server or failed review logs a warning and Hermes may proceed. No Hermes patch.

Deploy through the usual release procedure: migration 18 adds the tables/index, adapter 0.9.0 gets
its own provider folder, and existing data imports only after deploy. New sessions load the new
search tool; do not restart Hermes or manually touch live profiles. Import is safe to resume after
restart and safe to repeat. `bun run check:history` uses the dev launcher and a temporary bot, tests
continuous history/paging/search, kills only its dev server mid-import, and tests forced compression.
`bun live-checks/history-benchmark.ts` uses a synthetic 5,000-row dev copy (never production data).

## Threads

`server/threads/` owns shared bot exchanges, authored messages (including tool rows), and the durable
outbox in SQLite migration 14. `shared/thread-schema.ts` defines them. `ask_bot` and `list_bots` in
memory adapter **0.8.0** use the existing bot-bound capability. The caller is never a body bot id.
Any bot may ask any other; a new request creates a thread, while `threadId` continues the same work.
Oscar only reads: `threads.list`, `threads.open` and `threads.changed`; no thread write protocol.
The two participants read the same persisted transcript, including the other bot's work. Deletion
retains these records and the names captured at creation; the surviving bot can still read them.

The receiver works in its own hidden session, with its instructions, memory, skills, workspace and
full-access policy. Follow-ups reuse that session. The asking bot returns immediately; the answer is
queued as a hidden input in the exact originating session, even if Oscar has since started a new chat.
For nested asks this resumes the parent thread, then reports back to its requester. Main conversations
receive one `tool` reference with `threadId` per exchange in snapshots and through idempotent `thread` chat events; the
`threads.changed` push tells clients to refresh thread data. These lines are merged at the HTTP edge,
never written as fake user messages. They currently appear as plain tool lines; opening them is future UI.
Hidden request and continuation session aliases are persisted before submission and excluded from
after-chat reviews, including after restart. Thread activity sets working/finished on both participants
without unread; only the asking bot's eventual visible answer to Oscar can mark it unread.

Limits live in `thread-limits.ts`: depth **3**, **20 messages** per thread (requests reserve their answer),
**20,000 characters** per request and **2 concurrent deliveries**. No self-asking. Reaching a limit
refuses further asks and tells the bot to report back. Bot text passes memory-style secret, hidden
character and instruction-override checks and is delivered in a named, JSON-quoted fence, never as
Oscar's instructions. Delivery and admission ids are persisted and reused across transport failures
and restarts, using the routine runner's receipt machinery. A terminal unknown receipt is never
resubmitted with a new identity. Engine crashes cannot guarantee exactly-once external side effects.

Deploy: back up the live database, deploy, restart LilBot once to apply migration 14 and install the
versioned memory provider folder `lilbot-memory-v0-8-0`. Existing sessions keep their loaded tools;
start new sessions to expose `ask_bot` and `list_bots`. No Hermes patch or live profile cleanup.
`bun run check:threads` uses a free port, isolated data/workspace/skills directories and an unmatched
profile allowlist before creating two throwaway bots, then removes both profiles and directories.

## Restart recovery

Restarting **LilBot only** leaves Hermes turns and T3 tasks running. The browser reconnects and
opens the persisted main conversation; it does not resubmit the user message. Hermes supplies whether the turn is still running; LilBot reconciles the durable transcript into its own history, including tool work and the final answer.
Routines recover the same persisted run and admission receipt. Bot threads recover their outbox
and return the answer to the original caller session; they do not start a replacement exchange.
The T3 bridge reloads its sign-in from the same data directory; stable per-bot request ids allow an
uncertain launch to find the original T3 task, and its thread id allows later waits and reads.
A bridge call in flight can fail during downtime; the bot must retry that call after reconnecting.

`bun run check:restart` SIGKILLs only its own second server mid-turn, with temporary data,
workspaces, skills and an explicit temporary-profile allowlist. It checks chat reconnects during
work and after offline tool completion, a routine run and a thread round trip, using counter files
to detect repeated side effects. It deletes its profiles and confirms with `hermes profile list`.
T3 recovery has a unit test with a simulated upstream; the live grant is never copied into tests.

This covers a LilBot process restart with its data preserved, not a Hermes crash or a machine
reboot. An unknown engine receipt fails explicitly rather than repeating possibly completed work.
Failed deployments are recovered by an independent watchdog, described below. The self-development skill is not installed.
Keep development checks on an isolated server; never restart the live service as a test.

SQLite connections wait up to five seconds for short locks, including deploy copies and check clients.
Background timers catch failures and retry on later ticks; their error logs contain fixed task labels,
never exception payloads. A persistent database failure therefore logs and leaves work pending rather
than terminating the server.

## Deployment safety net

Production runs only from `~/lilbot/release`, a symlink to an immutable built folder under
`~/lilbot/releases/<commit>`. `~/code/LilBot` and T3 worktrees are development source only:
editing or pulling there does not change production. Nobody edits release folders. Only
`bun run deploy` creates/releases versions and restarts the live service.

Commit changes, then run `bun run verify && bun run deploy` in a clean source checkout.
Verification records the exact commit in that checkout's Git directory; dirty verification
runs the checks but grants no deploy marker. Deploy exports that commit with `git archive`
(no working tree or untracked files), installs its locked dependencies and builds its web app
in a staging folder, then renames it to the commit's release folder. A release manifest supplies
its running commit without needing Git metadata. Existing release folders are reused, never edited.

One-time leader installation, performed by the orchestrator after merging this change:

1. In the source checkout, run `bun install --frozen-lockfile` and `bun run verify`.
2. Add `~/.config/systemd/user/lilbot.service.d/release.conf` with:
   ```ini
   [Service]
   WorkingDirectory=%h/lilbot/release
   ExecStart=
   ExecStart=%h/.bun/bin/bun %h/lilbot/release/server/main.ts
   ```
   Keep `environment.conf` (`LILBOT_ENV=production`), `public-door.conf`, `access.conf`, all
   existing unit settings, data directories and ports unchanged.
3. `install -m 644 systemd/lilbot-deploy.service ~/.config/systemd/user/lilbot-deploy.service`
   then `systemctl --user daemon-reload`. Do not enable the watchdog; deploy starts it on demand.
4. Run `bun run deploy --bootstrap` once. It requires that no release symlink exists, builds
   the first release, backs up the existing database, switches the symlink and restarts through
   the watchdog. Existing data, keys, workspaces and skills stay where they are. There is no
   earlier release on this first conversion: if it fails, the watchdog restores the database,
   stops the service and retains the lock for manual repair. Subsequent deploys roll back normally.

Deploy freezes its watchdog under `<data>/deploy/runner/` and starts the independent
`lilbot-deploy.service`. It checks that the unit points at the configured release symlink, the
health endpoint belongs to that unit, and its data directory matches. An atomic
`<data>/deploy/lock/` excludes concurrent deploys, even if the caller disconnects.
After the build, the watchdog copies the database, atomically switches the release symlink,
restarts LilBot and checks health for 60 seconds. On failure it stops LilBot, restores the database,
switches back to the previous release, and restarts once. No Git checkout, reset, install or build
runs during rollback. It checks that old version for another 60 seconds. Failed recovery stops
the service and retains the lock, releases and copies for a person; it never loops. A killed
watchdog also leaves its lock. Development work, including uncommitted changes, stays untouched.

Keep the last three release folders and three database copies. The active release is protected
from pruning. Database copies in `<data>/deploy/backups/<id>/` contain `lilbot.db` and
`version.json`. SQLite's online backup API folds committed `-wal` pages into a self-contained
copy using the live database's locking/`-shm` state. Never raw-copy those three files independently.
Restore happens with the unit stopped and removes stale WAL/SHM files. Up to a minute of data
may be lost (accepted). The data directory is never replaced: `computer-server-key.pem`,
`engine-token`, `t3-grant.json`, other secrets, workspaces and engine sessions stay in place.
Copies use private directories/files (0700/0600). Preserve the server key securely alongside
recovery copies; never print or commit it.

`<data>/deploy/job.json` records the current outcome; `history/<id>.json` retains outcomes and
masked journal lines, and `notice.json` holds the last failure. `bun run deploy --status` tells
the deploying bot the outcome on its resumed turn; a surviving call returns it directly. The
app fetches the notice on reconnect, and every bot's next memory context includes it. No new
agent loop, developer bot or notification system. A healthy deploy does not erase failure
history; a person may remove `notice.json` after acknowledging it.

Overrides: `LILBOT_DATA_DIR`, `LILBOT_DEPLOY_UNIT`, `LILBOT_DEPLOY_WATCHDOG_UNIT`,
`LILBOT_DEPLOY_HEALTH_URL` (loopback HTTP), `LILBOT_RELEASES_DIR` and `LILBOT_RELEASE_LINK`.
Defaults match production. Other installations need a matching watchdog `ExecStart` pointing
to their data directory's runner and job file. `check:deploy` uses its own clone, release root,
symlink, data directory, free port and temporary systemd units, with an unmatched bot allowlist.
It never tests production or any live bot, including Chief of Staff.

Manual recovery: inspect `job.json` and both units, keep the service stopped, repair the cause,
select the recorded release and database copy, and preserve every key. Only after confirming
health should a person remove `deploy/lock/` and resume normal deployment. No automatic stale
lock removal. The development profile prefix, production guard and separate Hermes home are supplied by
the merged development-isolation work; release checks follow that boundary too.

## Library

`server/library/` owns delivered items in the `library_items` table; `shared/library-schema.ts`
defines the data. The engine-neutral service takes workspace and active-bot lookups. `give_file`
in the memory adapter (v0.8.0) calls `/engine/library/give` with its bot-bound capability; the
server ignores body bot ids and refuses unknown/deleted callers. A title and chat or routine run
are required. The endpoint resolves routine session aliases to the persisted run id for that bot,
ignoring caller-supplied run ids; ordinary deliveries retain chat provenance.

Items point to workspace files, never copies. Only explicitly given files appear. Kinds are
media (image/audio/video MIME), page (.md/.html/.htm), or file. Files are limited to 50 MiB.
`library.list` is paged newest first, optionally filtered by kind, with UTC Today / This week
(Monday start) / Older groups, total, next offset and missing status. `library.changed` carries
the bot id. `library.content` returns a download URL; its GET route applies the socket Host/Origin
checks, rejects cross-site fetches, and serves bounded bytes with MIME, attachment disposition,
no-sniff, sandbox and no-store headers. `library.workspace` lists a requested folder separately.
Linux descriptor-relative opens with no-follow flags prevent path/symlink swaps from escaping;
workspace-root symlinks and nonregular files are refused. The existing deletion choice archives
or deletes workspace files; tombstoned bots immediately lose library access and metadata stays.

Hermes declares incoming `CanonicalAttachment` paths but no outgoing attachment manifest on
`MessageCompletePayload` or `TranscriptMessage`. Automatic assistant attachment ingestion is
therefore unavailable until the contract exposes it; tool image previews are not deliveries.
No Library UI is built yet. `bun live-checks/library-check.ts` tests an isolated server and temporary
bot end to end, including the push, protocol list, separate workspace, and download.
## Chat attachments

`server/attachments/` owns incoming files and message associations (migration 17). The screens
(#66, Paper "10 Attachments") live in `web/src/attachments/` and use the protocol below.

Screens:

- Three ways in, several files at once: the composer's plus button (hidden file input), pasting files into
  the message box (pasted text stays text), and dropping files anywhere on the conversation column. While
  files are dragged over it a dashed "Drop to attach" area covers the message list with "Up to N files,
  X MB each". `file-drop.tsx`.
- Before sending (`composer-attachments.tsx`, AI Elements' Prompt Input attachments pattern on the shadcn
  `ui/attachment.tsx` part, in a `block-start` addon): a row above the text. Images are 64px thumbnails
  from the local bytes, files are chips (icon, name, size); each has a round remove button on its corner.
  A file still uploading shows a blue spinner and Send is disabled ("Send (waiting for uploads)") until
  every upload finishes. A message may be files only.
- Refused (same file): a red-outlined row per refused file with the reason, and one red line for files
  over the per-message limit ("3 files were left out. A message takes up to 10."). Both can be
  dismissed and never block sending the rest. "Too large: 48 MB. The limit is 20 MB." is worded from
  the file's size and `attachments.limits`; other refusals show the server's `reason.message`. The client
  counts files already staged (not refused) against the limit before `attachments.prepare`. Texts and
  rules are pure functions in `attachment-rules.ts` (tested in `tests/web/attachment-rules.test.ts`).
- In the conversation (`message-attachments.tsx`): images above the user's bubble as 120×150 tiles
  (radius 14, side by side, wrapping) that open the image viewer; files as chips that download through
  their server URL; then the text bubble (none when the text is empty). Queued messages show their
  files too. The send uses a client `messageId` (`newMessageId`, which also works on plain-HTTP pages);
  the `chat.send` answer or the `user.message` event, whichever comes first, fills in the same message
  (`withSentMessage` in `chat/chat-state.ts`), never a second bubble.
- Image viewer (`ui/image-viewer.tsx`, lazy, plain props `{ image: { url, name }, onClose }`): the image
  large, its name, download and close. Built for the Library (#54) to reuse.
- "Model cannot see images": a tinted note under the message, only when the message's `images.support`
  is `unsupported` with a positive count, with a "Change model" link to the Setup tab. Hermes reports
  `unknown` today, so the note does not appear with Hermes bots yet.
- File names are untrusted: always plain text (React text nodes, `alt`, `title`, `download`), never HTML.
- Staged files belong to one bot: switching bots empties the composer's files and ignores late uploads.

Protocol:

- `attachments.limits({})` returns `maxFileBytes` (20 × 1024 × 1024) and
  `maxFilesPerMessage` (10). `attachments.prepare({botId, files:[{name,size,mime}]})`
  reserves files in selection order. It returns one `{id,name,size,mime,state,url,uploadUrl,reason?}`
  per file, including refused entries. `reason` has a stable `code` and displayable `message`.
  Files after the tenth are `too_many_files`; path/control-character names are `invalid_name`;
  oversized files are `file_too_large`. The client retains existing selections when enforcing the
  message limit; the server independently enforces it again on send. Refusals do not block other files.
- PUT the raw File/Blob bytes (not multipart) to each accepted `uploadUrl`. State begins as
  `uploading`; the PUT response returns `ready` or `refused`, with a per-file reason.
  `attachments.status({botId,ids})` refreshes those records. Disable Send while selected files
  are uploading; omit refused/removed ids. Removing an unsent chip does not delete its workspace file.
  Interrupted uploads can be retried; if a partial file survived a server crash, the retry refuses
  it without overwriting and the client must prepare a new file. No upload resumes at a byte offset.
- `chat.send({chatId,text,attachmentIds,messageId})` requires a client UUID `messageId` when
  attaching files. Text may be empty. Every attachment must be ready and belong to the open
  chat's bot. Retries use the same id, text and file list (Hermes admission idempotency); changing
  that payload is refused. The response includes `message:{messageId,text,attachments,images}`.
  The same data is broadcast as the `user.message` chat event. The web app reconciles both by
  `messageId`, including optimistic/queued sends, rather than appending a second user bubble.
- User items in chat snapshots carry the same optional `messageId`, `attachments` and `images`.
  The association is saved before submission. A unique display-only marker in the engine's stored
  text identifies the exact row; the HTTP edge replaces it with the original text and metadata.
  The match allows the engine’s prepended image analysis and appended image references. This avoids associating repeated
  identical messages by index or text alone. `api_text` keeps
  the marker out of model input. Reopening on another device or after a server restart reads
  SQLite; it never resubmits a message. An uncertain send is retried only by explicit client action.
- `images` is `{support:'supported'|'unsupported'|'unknown', imageCount}`. Show the
  “model cannot see images” note only for `unsupported` and a positive count. The installed Hermes
  `model.options` catalogue's `ModelCapabilities` declares fast/reasoning flags, **no vision field**.
  Therefore Hermes returns `unknown`, never a guessed false/true based on model names. Automatic
  text-only-model detection requires a future declared capability in Hermes. The neutral protocol
  already supports that signal and retains the state at send time.
- GET each attachment's `url` for original bytes. Images can use the URL in the viewer; files
  download with their original display filename. Headers force attachment disposition, no-sniff,
  sandbox and no-store. The route is shared by the private and authenticated Access listeners,
  with Host/Origin/cross-site checks, and is never installed on the public helper door.

Uploads stream to generated names inside the bot's `attachments/` folder, through Linux
file descriptors with no-follow and exclusive creation; original names never form paths. The
stream itself enforces the size cap. Directory swaps are refused, partial failed writes removed,
and reads verify SHA-256 against the upload before returning bytes. Names are untrusted display
text. Browser MIME is normalized; PNG/JPEG/GIF/WebP magic determines image delivery. Other image
formats are refused with `unsupported_image`, rather than silently sent as model-visible images.

`BotEngine` receives the files with the message. Hermes stages image bytes with canonical
`image.attach_bytes`, then passes its declared `{path,mime}` to `prompt.submit.attachments`.
The installed implementation only admits images from its profile cache there, so non-images
are supplied as JSON-quoted workspace references in `api_text`, accessible with normal file tools.
The note explicitly treats file names and contents as data, not Oscar's instructions.
Deletion's existing archive/delete workspace choice includes attachments; tombstones immediately
refuse uploads and reads. Metadata remains in SQLite for attribution. Deploy applies migration 17
with the normal verified deployment; no Hermes modification or production check is needed.

`bun run check:attachments` uses the dev launcher and a temporary dev bot, checks a generated
red/blue PNG, a text file, oversize refusal, the live metadata event, reload and byte-identical
image reopening, and deletes the bot and scratch folders in `finally`.

## Coding (T3 Code)

Coding goes to T3 Code, Oscar's coding backend, through its MCP tools. LilBot builds no coding engine,
worktree or pull-request handling. Running commands, reading files and using apps stay ordinary bot work.

- One LilBot-owned connection (`server/connections/t3-connection.ts`) is given to every bot by every
  engine (`BotEngine.prepareConnections`, called from `BotRuntimes.state` on creation, startup and before
  use). It is the one exception to "tools and MCP connectors stay with the engine". Hermes gets it as the
  profile MCP server `lilbot_t3` through `mcp.servers.list/remove/add` and `reload.mcp` when it changed
  (`hermes-connections.ts`); other servers in the profile are untouched. Hermes keeps a server's tool list
  until its settings change, so the URL carries the sign-in state (`?signin=<issued-at|signed-out>`): when a
  sign-in appears, expires or is revoked, the server notices within five seconds and re-prepares every bot
  (remove, `reload.mcp`, add, `reload.mcp`), which reconnects it and loads the new tool list.
  If an unrelated inherited server fails that reload, preparation succeeds only when
  `mcp.servers.status` confirms every requested LilBot connection is connected.
- The bridge (`t3-bridge.ts`, `/engine/t3/mcp` on LilBot's loopback port) forwards Streamable HTTP MCP to
  T3 Code (`http://127.0.0.1:3773/mcp`, `LILBOT_T3_MCP_URL`). Callers present a per-bot key
  (`HMAC(engine token, "t3-bridge:<bot id>")`), which Hermes keeps in the profile's `.env`; deleted bots are
  refused. The bridge narrows the tool list to `T3_TOOLS` (projects, threads, capabilities, linked
  environments, pull-request links; no project deletion, themes, schedules or machine linking) and
  prefixes each `clientRequestId` with the bot id, because T3 scopes retry keys to the one shared sign-in.
- One shared sign-in (decided with Oscar 2026-11-17): a single T3 MCP grant with Full access, stored in
  `<data dir>/t3-grant.json` (0600), never printed, logged, committed, or put in a bot's instructions or
  memory. `bun run t3:sign-in` redeems a one-time pairing code Oscar creates in T3 Code (on the leader's
  environment: Settings → Sharing & access → Create link → Copy code; the link works too). It runs T3's
  OAuth PKCE flow headlessly (`/oauth/mcp/decision` returns the redirect as JSON). Codes last about five
  minutes. T3 has no refresh grant: the sign-in lasts 30 days, then Oscar approves again the same way.
- Missing, expired or revoked: the bridge answers MCP itself with one tool, `t3_connection_status`, whose
  answer tells the bot what to tell Oscar. A T3 401 on an unexpired grant marks it revoked. It never passes
  T3's 401 on, so an engine never starts its own OAuth. `connections.status` returns the state and expiry
  (never the token); `connections.changed` is pushed when the server notices a change.
- Instructions are the LilBot skill `t3-coding` (`server/connections/t3-coding-skill/SKILL.md`), installed
  into the skills library at startup and restored if it differs. It points bots at `~/code/home/AGENTS.md`
  for machines, models and repo locations, asks for one launch with a stable `clientRequestId`, following
  with `t3_thread_wait`/`t3_thread_read`, and the T3-returned `link` in the chat right away and with the result.
- No Settings screen for the sign-in yet (`needs-ui`). T3 tasks outlive a LilBot restart. The Hermes
  turn retains the returned thread id and can resume `t3_thread_wait`/`t3_thread_read` after a lost bridge
  call; an uncertain launch retries the original `clientRequestId`, never a replacement task. There is
  no separate LilBot follow-up queue after the Hermes turn ends.
- `bun run check:coding -- --code-file <file>` (or the code on stdin) signs in first, then on an isolated
  server with a temporary bot checks the signed-out, expired and refused messages, a repeated launch, and a
  real task in a throwaway repo registered as a temporary T3 project (run in the project root, so no
  worktree or branch is made: T3's MCP has no worktree removal). Cleanup stops, settles and archives the
  threads, removes the project, deletes the profile, revokes the check's own sign-in and removes the files.
## Computers

`server/computers/` owns computer records, Ed25519 public keys, one-time install codes,
replay nonces and durable request identities (migration 15); migration 16 adds persistent receive
allowances and an active-only bot request index. `shared/computer-schema.ts`
is shared with the standalone `helper/` client. The leader is always `leader` and executes
locally through the same bounded operation runner without a helper. Every bot can use every
computer; the authenticated bot id owns its requests, never an id from the body.

- Private browser methods: `computers.list`, `computers.installCode({ name })` (10 minutes,
  single use), `computers.remove`; changes push `computers.changed`. The minted name wins over
  the helper's advisory hostname. OS is an enum; home is at most 512 characters with control and
  hidden formatting characters refused. `keyConflict` reports a competing key connection. No UI is built yet (`needs-ui`).
- The public door is a separate loopback listener, off by default. Enable with
  `LILBOT_PUBLIC_ENABLED=1`, `LILBOT_PUBLIC_PORT=3372`. Its port must differ from the private app.
  It accepts only POST `/helper/register` and GET `/helper/connect` (WebSocket), with 8 KiB bodies.
  Both listeners disable development errors and return plain 500s. The private listener refuses
  `cf-connecting-ip`, `cf-ray` and Cloudflare `cdn-loop` headers before routing, even with a valid Host.
  Never add the public name to `LILBOT_ALLOWED_HOSTS`. No webhook, app, browser socket or engine
  endpoint is exposed by the door. Live deployment: see "Public door deployment" below.
- Unknown connect ids are refused before allocating rate-limit entries. Failed authentication and
  registration attempts are limited to 20/address/minute, and failed connects to six/(computer,address
  group)/minute. Valid signatures have a separate six/computer/minute budget that remains available
  when the unauthenticated tables are full. IPv4-mapped addresses use IPv4 /32; IPv6 uses /48.
  At 4096 live unauthenticated groups new groups fail closed without recycling budgets.
  Nonce expiry is indexed. Socket message/byte buckets run before
  parsing; progress is limited to once per second per request and 8 KiB, with 8 active requests.
  Heartbeat/progress spacing uses arrival time before queueing; early frames are dropped without
  disconnecting. Heartbeats are at most once per five seconds. Behind Cloudflare, the address is `cf-connecting-ip`.
  An edge rate-limit rule (hostname + exact helper paths, 20 requests/60 seconds/IP, 60-second block)
  needs Cloudflare Pro or higher. Oscar chose the Free plan on 2026-11-17: the zone has no such rule and
  LilBot's own limits above are the protection.
  Registration sends a code identifier and HMAC over the public key and hello, plus key proof;
  the raw install code never crosses the network. Code consumption remains atomic.
- LilBot creates `computer-server-key.pem` under its data directory, mode 0600. Back it up securely
  alongside the database and preserve it on redeploy. The install code carries its SHA-256 public-key
  fingerprint: one paste registers and pins the server. Every connection proves the fresh helper
  nonce with that key; frames in both directions sign a domain-separated payload digest,
  connection nonce and ordered sequence.
  Unauthenticated, altered, replayed or different-key work is ignored. Key replacement requires
  explicit helper re-registration with a new install code. TLS remains required except on loopback.
- Helpers sign method, path, computer id, timestamp and one-use nonce (60s window). Revocation aborts
  work only through a signed `revoked` frame. Unsigned close codes never abort work; server
  restarts preserve remote commands. A competing connection suspends dispatch while both receive
  a three-second challenge. A responsive newcomer replaces an unresponsive incumbent; two responsive
  peers are closed and `keyConflict` blocks dispatch until the owner removes/re-registers the computer.
  Revoked public keys remain tombstones: reconnect authenticates and receives proof plus signed revoke.
  The helper aborts work, removes its service and exits on verified revoke, including after offline removal.
  Reconnect backoff resets only after verified server proof. The helper identity is
  still a 0600 PEM file in a 0700 directory. Keychain is deferred: the built-in security CLI's shared
  trust would also allow same-user bot commands; a useful per-helper boundary needs a signed native
  Security.framework integration. Full-access bots share the OS user's authority.
- `lilbot-computers-v1` is an independent Hermes plugin; the memory adapter is unchanged. Its
  `computer_exec` invokes Hermes' own `detect_hardline_command` before submitting, with no Hermes
  fork or patch. Computer hard stops are a guard for full-access bots, not a security boundary:
  direct engine submissions and write/copy operations do not enforce Hermes protected-path
  refusals. The engine-neutral service requires `full-access` for all computer operations.
  Tools: `list_computers`, `computer_exec`, `computer_read_file`, `computer_write_file`,
  `computer_list_folder`, `computer_request`, `computer_cancel`, `computer_copy`. Machine output
  is untrusted data. Reads return base64; writes accept UTF-8 or base64.
- Offline synchronous calls fail immediately; explicit background calls queue. Foreground waits
  stop at 25s. Eight 5.6 MB results cannot all arrive within that wait below about 1.8 MB/s; retry with the same requestId to recover the eventual result without re-executing. Waits allow five seconds for a disconnected helper to return during a wait. Per bot and
  computer, at most 32 pending/running/cancelling requests; at most 8 executions per
  leader/helper. Pending dispatch reads only id/status, loading payloads only when sent. Cancellation
  of undispatched work settles locally; dispatched work remains `cancelled` until a final result
  makes it terminal `cancel_acked`. The result and `cancelRequested` flag preserve late outcomes;
  the helper resends its stored result if cancellation arrives after completion.
- Payloads live separately from queue metadata. Completed operations become their SHA-256 digest
  and byte size; tool responses never echo them. Foreground results expire after five minutes,
  background results after 24 hours. Queued work expires after 24 hours with an explicit failure.
  Indexed pruning processes at most 64 rows or about one large payload per tick. SQLite triggers keep
  global accounting and per-bot (64 MiB) byte totals atomically. Admission enforces the per-bot
  quota only, so four full bots cannot deny a fifth its allowance; total disk use scales with bot count.
  Read admission reserves 5.6 MB for its
  result; operation JSON is capped at 5.7 MB. Omitted results are failed and never overwrite workspace files.
  Progress stays in memory as a 4 KiB tail; at most eight completed results are cached for active readers. Helper journals retain unacknowledged results, admitting
  at most 32 unacknowledged/running operations with worst-case space reserved; acknowledgements remove
  payloads, not execution receipts. Control replies wait for buffer space and take priority; a 100 ms
  pump sends one result at a time, oldest finished first, once per connection; unacknowledged results retry after reconnect. Result rows
  are loaded individually, not eight large payloads at each heartbeat. Old backups need separate retention. Heartbeats run every 10s;
  35s without one is offline. Dispatch waits for socket buffer space, checks send outcomes and resumes
  on drain/tick; commands send a small progress tail once a second and full output only on completion.
- Each live request admits at most eight final frames and 48 MB of final-frame payload across all
  connections and server restarts (migration 16). Finished and unknown results are acknowledged without spending receive allowance. Exhausted live requests fail with an acknowledgement, never a disconnect.
  Helper traffic, submissions and dispatch serialize per computer, never behind another computer's
  queue; workspace I/O does not hold those queues. Deleting a bot seeks only its active requests.
  Failure to configure the computers plug-in is logged without making the bot unavailable.
- Results are bounded to 6 MB serialized JSON, with an explicit truncation marker. Commands have bounded output
  and a timeout (60s default, 1h maximum). Cancellation kills the process
  group and cancels pipe readers, so escaped descendants cannot keep requests busy. Child groups are
  tracked; an independent shell watchdog kills a group after abrupt helper death. Deliberate process
  detachment is not a sandbox boundary for full-access users. Files/copies are capped at 4 MiB;
  workspace transfers use descriptor-relative, no-follow opens and require single-link regular files.
- Build native with `bun run build:helper`; cross-compile with
  `bun scripts/build-helper.ts bun-darwin-arm64 dist/lilbot-helper-macos-arm64` (x64 also supported).
  Deliver both binary and `.sha256` from a trusted channel. The `.sha256` sidecar detects
  corruption, not tampering; it is not a signature. Run `./lilbot-helper install <https-origin>`
  with the install code on stdin. Updating stops the service, checks SHA-256, writes/chmods a sibling
  temporary file, atomically renames it, then starts the service. macOS uses launchd and Linux systemd
  user units. `./lilbot-helper reset` stops/uninstalls the service and removes the local identity
  for re-registration with a fresh code, retaining execution receipts. Config/journal: `~/.config/lilbot-helper` (`LILBOT_HELPER_CONFIG_DIR` overrides).
- `bun run check:computers` uses free ports, temporary data/workspaces/skills, a sentinel profile
  allowlist and one temporary bot, always cleaning up in finally. It checks real plugin calls,
  Hermes hard-stop refusal before submission, queue/reconnect, cancellation termination, a second
  door with a different key, signed revocation versus server restart, fast
  exec, copies, reused codes, wrong/revoked keys and private routes/headers.
  `tests/computers/adversarial.test.ts` measures a same-process private `/api/health` listener during
  signed floods with 100k receipts, 1M-row indexed admission, eight parallel 4 MiB copies, eight
  coloured commands and offline storage filling. It also checks delivered bytes and per-bot isolation.
  The harness uses five-second flood windows and bounded concurrent health probes, weights missed
  5 ms probe intervals, and reports p99/max plus total event-loop stall above 20 ms. The 250 ms
  weighted-p99 regression ceiling includes large synchronous JSON/signature/storage turns; it is
  not a claim that every request completes within 50 ms. `helper-load.test.ts` runs a real helper
  three times with a chatty background command and eight parallel 4 MiB copies in each direction,
  asserting zero disconnects and byte-identical delivery. It prints binary size and idle RSS.
  The fourth independent review (PR #50) cleared the tunnel against unauthenticated lockout.
- Real-Mac smoke checklist (not runnable on the Linux leader): obtain the trusted arm64/x64 binary,
  confirm Gatekeeper handling, install with a fresh code and verify the launchd user service survives
  logout/reboot; register and check name/OS/home, execute/read/write/copy, sleep and wake during work
  and confirm reconnect without duplicate execution, then revoke online and offline and verify the
  signed revoke stops work and removes launchd.
- Public door deployment (live since 2026-11-17, #51):
  - Hostname `lilbot-connect.lilgroup.studio` (zone `lilgroup.studio`, Cloudflare Free), tunnel
    `lilbot-connect`, its own connector and credentials, separate from T3 Code's tunnel and the hosting server.
  - `~/.cloudflared/lilbot/config.yml` routes only `^/helper/(register|connect)$` on that hostname to
    `http://127.0.0.1:3372`; everything else gets 404 at the edge. The tunnel credentials JSON sits beside
    it (0600). The same tunnel also carries the app hostname (see "App behind Cloudflare Access").
  - Cloudflare access on the leader: `~/.cloudflared/cert.pem` (0600, zone `lilgroup.studio`, approved by
    Oscar on 2026-11-19 and kept on purpose) lets agents manage LilBot's own DNS names and tunnels with
    `cloudflared tunnel route dns ...` without him. Never print, log or commit it, and touch only LilBot's
    own tunnels and names; the account holds others.
  - `cloudflared` 2026.10.4 in `~/.local/bin`, run by the user unit `lilbot-tunnel.service`
    (`--no-autoupdate`). The door is enabled by the drop-in
    `~/.config/systemd/user/lilbot.service.d/public-door.conf` (`LILBOT_PUBLIC_ENABLED=1`,
    `LILBOT_PUBLIC_PORT=3372`).
  - Check from outside: every path except the two helper paths returns 404; `/helper/connect` without a
    valid key returns 403.
  - Roll back: `systemctl --user disable --now lilbot-tunnel.service` (hostname unreachable at once);
    to also close the door, delete the drop-in, `systemctl --user daemon-reload` and restart
    `lilbot.service`. The private app is unaffected either way.

## App behind Cloudflare Access

The app has a third, loopback-only listener, separate from the private app and helper door.
It is off by default. Enable with `LILBOT_ACCESS_ENABLED=1` and set **all** of:

- `LILBOT_ACCESS_PORT` (suggested `3373`, must differ from the private and helper ports).
- `LILBOT_ACCESS_HOST` (the public hostname, e.g. `bot.example.com`, without a scheme or port).
- `LILBOT_ACCESS_TEAM` (the team domain, e.g. `<team>.cloudflareaccess.com`, without a scheme).
- `LILBOT_ACCESS_AUD` (the Access application's audience tag).
- `LILBOT_ACCESS_EMAIL` (the allowed sign-in email, service environment only; never commit or log it).

Missing/invalid settings stop startup before opening listeners. The Access listener serves the same
built app, browser routes (including library downloads), and `/ws` as the private app. Every HTTP
request and socket handshake requires an RS256 Access JWT in `Cf-Access-Jwt-Assertion`; only `/ws`
upgrades also accept the `CF_Authorization` cookie. A present header takes precedence over a cookie.
It checks the configured issuer, audience, expiry/not-before (30 seconds of skew), and email
(case-insensitive). Keys come only from `https://<team>/cdn-cgi/access/certs`, cached for ten minutes;
an unknown key triggers refresh after a 30-second cooldown. Failed fetches have the same cooldown.
Invalid/missing tokens, wrong Host or a mismatched Origin get a plain 403. Errors are plain 500s;
development error pages are disabled. Tokens and the email are never logged.

`/engine`, `/engine/*`, `/helper`, and `/helper/*` are always refused, including with a valid JWT.
The private listener's Cloudflare-header refusal and helper door's two-path boundary stay in place.
Never point the app tunnel at the private port or add the Access hostname to `LILBOT_ALLOWED_HOSTS`.

`bun run check:access` starts an isolated second server with temporary data/workspaces/skills and
an unmatched profile sentinel; no real bot or Cloudflare account is used. Its local RSA/JWKS fixture
uses `LILBOT_ACCESS_TEST_CERTS_URL`, accepted only for HTTP on `127.0.0.1` with all three isolation
directories and exactly `LILBOT_BOT_IDS=isolation-access-check`. Do not set this override in deployment.

Deployment (live since 2026-11-19, #75):
- `https://bot.lilgroup.studio` is served by the `lilbot-connect` tunnel through its own ingress rule,
  hostname `bot.lilgroup.studio` to `http://127.0.0.1:3373` (the Access listener only). The helper-path
  rule for `lilbot-connect.lilgroup.studio` is unchanged.
- A Cloudflare Access self-hosted application on that hostname allows exactly one email (the owner's,
  kept out of this repo), signs in with the one-time email code and lasts 24 hours. It was created before
  the DNS name, so the hostname was never reachable without the sign-in.
- The listener's settings (`LILBOT_ACCESS_ENABLED=1`, `LILBOT_ACCESS_PORT=3373`, `LILBOT_ACCESS_HOST`,
  `LILBOT_ACCESS_TEAM`, `LILBOT_ACCESS_AUD`, `LILBOT_ACCESS_EMAIL`) are in the 0600 drop-in
  `~/.config/systemd/user/lilbot.service.d/access.conf`, never in the repo.
- Check from outside: every path, including `/ws`, `/api/*`, `/engine/*` and `/helper/*`, answers with a
  redirect to the Access sign-in; a forged token sent through the tunnel is redirected too, and sent
  straight to the listener gets 403.
- Roll back the app hostname only: remove its ingress rule from `~/.cloudflared/lilbot/config.yml` and
  restart `lilbot-tunnel.service` (the helper door keeps working); optionally delete the DNS name and
  the `access.conf` drop-in, then `systemctl --user daemon-reload` and restart `lilbot.service`.
  Stopping `lilbot-tunnel.service` closes both public names at once. The tailnet address is unaffected.

## Skills

`server/skills/` owns a shared standard SKILL.md library at `~/lilbot/skills`
(`LILBOT_SKILLS_DIR` overrides it), metadata/authorship and per-bot off switches in SQLite (migration 12, after routines 10 and Library 11).
Chat, routine runs and memory reviews prepare the same catalogue and per-bot off switches. Deleting a bot removes its off switches, retaining library skills and their authorship.
All skills default on. `skills.list`, `skills.read`, `skills.setEnabled` and `skills.changed`
serve clients; Setup receives the same skill states through its existing abilities data.
A separate Hermes skills plug-in leaves the memory adapter version alone. It overrides the
three skill tools to read the authoritative catalog and route writes to the authenticated
`/engine/skills/*` API. New and edited text rejects secrets and hidden characters; skill
instructions themselves are allowed. The bot's bound capability supplies authorship.
These switches control offered skills, not filesystem access for full-access bots.

Only non-deleted bound bots are imported/prepared. Import copies user skill folders once per
source path, never moves or deletes profile files. `.bundled_manifest` identifies shipped
skills, which stay with Hermes. Identical copies coalesce; different contents get a stable
hash-suffixed name, preserving both. Existing imported text is not retroactively safety-filtered;
new writes are. Binary support assets are copied unchanged. Imported provenance stays in SQLite.
Hermes searches profile-local skills before external/create directories, so LilBot suppresses
the stale user entries in Hermes' manifest and supplies its own catalog through the plug-in.
`skills.create_dir` and `skills.external_dirs` also point to the library. Native engine skills
remain with Hermes; attempts to change one through the app skill tool require first creating
an app-owned skill. Skill tool changes apply immediately; prompt catalogs refresh next session.
No profile cleanup is part of this change. Future removal of duplicate profile skill folders
must be a separate change after checking import results and backups.

`bun run check:skills` runs a second server with temporary data, library and workspaces and an
explicit temporary-profile allowlist. It proves skill use, per-bot exclusion, and authored writes,
then deletes every temporary native profile and directory. Never run an unrestricted test server.

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
   machine: loopback only, no browsers, token from `<data dir>/engine-token`. Unknown and deleted LilBot ids
   are refused, including the bot behind a creation capability. The Hermes adapter is a memory
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
own folder and provider name (`lilbot-memory-v0-8-0`): a new version is a new folder, loaded fresh on the bot's next
session. To ship a plug-in change: bump `version` in `plugin.yaml` and `VERSION` in `__init__.py`, and restart
LilBot. At start-up `BotEngine.refreshMemory` takes only the non-deleted database bindings for its engine, by native id,
and reinstalls older adapters only for those profiles. All start-up passes that touch profiles must use these
bindings, never all engine profiles. Permission preparation follows the same active native-id bindings.
Roster/detail reads use database identities and cached runtime state, with `runtimePending` until preparation
finishes; they never wait for profile preparation, memory refresh, or the activity observer. Only the
one-time import into a new database needs engine discovery. Memory connection also walks only non-deleted database bots.
No Hermes restart is needed. LilBot logs a warning when a bot still calls with an older adapter.

### The after-chat review

A bot saves what it notices during a chat; the review catches what it missed. Hermes' own background review only
runs with Hermes' built-in memory tool, which a connected bot no longer has, so LilBot has its own.

- The plug-in hands every finished turn of a real conversation to `/engine/memory/turn` (`sync_turn`, on a thread;
  not for scheduled runs or sub-agents). `server/memory/review-queue.ts` keeps them only until reviewed.
- `server/memory/memory-reviewer.ts` checks every 20 seconds and reviews a bot once 10 turns wait, or once at
  least 3 wait and the chat has been quiet for 2 minutes. `LILBOT_REVIEW=off`, `LILBOT_REVIEW_TURNS` and
  `LILBOT_REVIEW_QUIET_SECONDS` change that.
- Each reviewer tick drops queued turns for unknown or deleted database bots, even below the review threshold
  or with reviews disabled. Owned bots with missing runtimes keep their turns.
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
user's message automatically, and holding a turn's writes until the turn succeeds. Pre-compression saving is described under Conversation history.

## Routines

`server/routines/` owns routine records, schedules and durable run history in LilBot's SQLite file,
keyed by LilBot bot id. Hermes' `cron.manage` was considered: mirroring schedules would add a second
source of truth and tie recovery to an engine. Instead LilBot dispatches through `BotEngine.runRoutine`;
it never creates, changes or removes Hermes cron jobs. Existing external jobs stay independent.

- A schedule is an interval in seconds, daily at HH:MM, or weekly on a local weekday at HH:MM.
  Calendar schedules default to `Australia/Adelaide` and store an IANA time zone. DST gaps skip that
  day's nonexistent time; repeated times run at their first occurrence only. The API includes a plain
  description such as "every day at 08:00 (Australia/Adelaide)".
- `create_routine`, `list_routines`, `pause_routine`, `resume_routine` and `delete_routine` come from
  adapter **0.6.0** and remain in **0.8.0** alongside `give_file`. They use the existing bot-bound capability; a body cannot select another bot.
  `createdBy: oscar` means the bot is acting on an explicit request, `bot` means its own initiative.
  Attribution relies on the bot following that instruction, not a security boundary. The self-created
  limit is five, including paused routines; the minimum interval is five minutes for all routines.
  Repeating a create request id returns the original; deleting leaves a tombstone against resurrection.
- The one-second scheduler atomically creates a run and advances next-run time before engine calls.
  After downtime it runs **once for the oldest missed time**, skipping other missed slots and returning
  to the future schedule. A routine never overlaps itself. Pause prevents new occurrences; an already
  admitted run may finish. Resume starts with the next future time, without replaying paused time.
- Each run gets its own hidden, full-access (`yolo`) Hermes session in the bot's folder. It never changes
  the main conversation. Persisted run ids supply both session-creation and prompt-submission request
  ids: retries recover the same session and admission. Transport failure retries after 30 seconds;
  durable receipts recover completed results even when event replay has expired. If Hermes says a
  run's outcome is unknown, show a failed run rather than risk repeating side effects. This guarantees
  one admission per occurrence, not exactly-once external effects if the engine itself crashes mid-task.
- Runs emit activity and can mark the bot unread. Both session aliases are persisted before submission
  and excluded from the after-chat review, including after restart. Results remain in Routines; no message is posted into the main chat. Deleting a bot removes schedules and history,
  and tombstoned bots cannot dispatch even if runtime deletion is still retrying.
- Browser methods: `routines.list`, `routines.pause`, `routines.resume`, `routines.delete`, and
  `routines.openRun` (returns a tracked chat snapshot, preserving main chat). Lists include the newest
  50 runs; all run records remain in the database. `routines.changed` invalidates lists. The typed web
  client is in `web/src/routines/`; the panel design remains `needs-ui` and is not part of this backend.
- `bun run check:routines` uses a second server and temporary bot. A short-interval override requires
  all of `LILBOT_DATA_DIR`, `LILBOT_BOT_IDS`, and `LILBOT_ROUTINE_TEST_INTERVAL_SECONDS`; never use it
  on the live server. It exercises creation from chat, a real file-writing run, opening history, pause,
  restart, resume and delete, then removes the native profile and temporary directories.

## What Grok Bot does (reference, not a spec)

Studied on 2026-11-16 from the app's code (1.0.1) and screenshots (1.1.0). Reports: `~/agent-tmp/grokbot-findings.md`,
`~/agent-tmp/grokbot-ui-ref/`, and Oscar's `~/code/Grokbot-cli/docs/`. Copy structure and behaviour, never its
artwork, names or text.

- Layout: bot roster left (main bot pinned on top, named sections, latest-message preview, unread dot), one ongoing
  conversation in the middle, a details panel on the right (Activity: routines, suggestions, computer, voice;
  Library: pages, media and files, newest first, tabs only when there is more than one kind).
- Bot menu: pin, move to section, mark unread, rename, copy conversation id, hide, delete. The main bot instead has
  unpin and "replace with a different bot", which only changes which bot is the main one.
- Create bot: name, avatar cover shape, cover colour and face colour, nothing else. A one-time id makes a retry safe. A typed first message
  replaces the bot's automatic introduction.
- Avatars: ten vector cover shapes and twelve colours for both cover and face. The tilted cover, highlight, screen, eyes and smile scale to any size. Shape and cover default from the bot's id; a missing face colour reads as ink without rewriting the row. Preferences store all three choices (schema 13). The reusable avatar dialog (`bots/edit-avatar-dialog.tsx`) previews at 96px and opens from the bot menu's "Name and avatar". Create uses the same three picker rows.
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

- Activity observation polls persistent profile-bound sockets every second; very short activity may only be seen at completion. Hermes live listings expose at most 200 sessions per profile. A future host-scoped subscription could reduce latency.
- The history screen (#67) still needs to consume the paging metadata; the existing screen displays the latest page.
- Hermes limits a transcript row to 2 MiB and may rotate very old compression lineages; a first import can only recover rows Hermes still exposes. Already copied rows remain in LilBot.

## Rules

- Never test against the live service or any live bot, including Chief of Staff (`default`). Every check uses an
  isolated server with temporary bots only.

- Do not fork or patch Hermes. Configure it, or build on its API.
- The attach ticket and anything under `~/.hermes` that holds credentials are never printed, logged or committed.
- Test on a second server (`LILBOT_PORT=3371 LILBOT_DATA_DIR=<tmp> LILBOT_WORKSPACES_DIR=<tmp> bun server/main.ts`)
  with temporary bots, never Oscar's real bots, and
  delete them afterwards with `hermes profile delete <id> -y`. Set `LILBOT_SKIP_MEMORY_SETUP=1` on every test
  server so start-up does not change memory plug-ins or endpoints.
  Always set `LILBOT_BOT_IDS` to a temporary profile allowlist (or an unmatched sentinel before creating one):
  startup applies permission settings as well as identity. Never use an unrestricted test roster.
  Do not chat with or edit real bots on the test server.
- Each slice ends with a real check against an isolated server with temporary bots only: `bun run verify`, `bun run check:live`, then drive
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
- `bun live-checks/permissions-check.ts`: isolated second server; repairs a temporary profile from manual to off,
  runs a harmless recursive delete and file write, and checks no approvals remain. Deletes its profile and folders.
- `bun run check:routines`: isolated routine create/run/open/pause/restart/resume/delete check.
- `bun run check:restart`: isolated mid-turn process restarts; chat, routine and thread counters must stay at one.
- `bun run check:deploy`: temporary clone, data directory, free port and two temporary systemd user units;
  checks healthy deploy, rollback at 60 seconds, restored WAL data, notices, and failed recovery. No profiles created.
- `bun run t3:sign-in`: signs LilBot in to T3 Code with a pairing code from stdin or `--code-file`.
  Uses `LILBOT_DATA_DIR`; the running server picks the new sign-in up without a restart.
- `bun run check:coding`: isolated coding check through T3 Code (needs a fresh pairing code; see Coding).
- `bun run check:memory`: connects a temporary bot to a throwaway memory, tells it facts, checks a new session knows
  them, prints tokens per turn, then deletes it. Inherited memory is disconnected before the baseline turn. A few model calls.
- `bun run start`: run the server. `LILBOT_PORT` and `LILBOT_HOST` override the defaults.
- `bun run dev`: Vite with hot reload, proxying to a dev server on `LILBOT_PORT` (default 3371); production ports are refused.
- After a change: run `bun run verify` and relevant isolated checks, then use `bun run deploy` from a clean source checkout when deploying.
  Bots must only restart the live service through `bun run deploy`; never restart production as a check.
