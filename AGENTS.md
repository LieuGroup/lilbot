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
  database/          LilBot's own SQLite file and its schema steps.
  engines/           Whatever actually runs the bots.
    bot-engine.ts        the contract every engine must fulfil
    hermes/              the Hermes engine: the only place that knows Hermes exists
      memory-adapter/      the small plug-in Hermes loads to reach LilBot's memory

web/src/           The web app (what you see in the browser).
  app/               start-up, the routes, the connection to the server, styles
  bots/              roster, bot menu and its dialogs, create bot, details panel and its Setup tab
  chat/              the conversation
  activity/          the details panel's Activity tab
  library/           the Library tab (placeholder until #14)
  memory/            the Memory tab
  routines/          data client for the future Routines panel
  settings/          the Settings dialog (delete defaults)
  ui/                shadcn/ui parts (added by the shadcn CLI, ours to edit) and our own small shared
                     parts built from them (tab body, page header, icon button, notice, bot badge, form field)

tests/             Automatic tests, in the same folders as the code they test.
live-checks/       Checks that talk to the real Hermes with a temporary bot.
```

Rules that keep it this way:

- A request flows downward only: `http/` -> `bots/`, `memory/`, `routines/`, `threads/` or `library/` -> `engines/` and `database/`. Nothing lower may
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
    the chat's first load stays small (about 212 kB of JavaScript and 16 kB of styles, gzip -9, counting every
    file `dist/index.html` references; Vite's per-file sizes alone understate it). The bot menu, its dialogs and
    Settings are lazy too: the roster only writes to small stores and loads them on hover or first use.
- Checks: Biome, `tsc`, `bun test`, Vite build, all through `bun run verify`. `bun run check:live` is the live
  check against the running Hermes.

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
  Tools, MCP connectors and conversation transcripts stay with the engine. Skills belong to LilBot. Identity is imported once, then LilBot wins
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
  bubble, tool lines 13px, a round composer with an ink send/stop button (stop while the bot works and the box is
  empty) and a disabled attach button kept for later.
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
| Identity (name, function), instructions, model, permission mode, engine binding | LilBot | `bots` table in LilBot's database |
| Skills and per-bot skill switches | LilBot | shared skills library and SQLite |
| Tools and MCP connectors | the engine | Hermes profile |
| Workspace: one folder per bot on the shared computer | the bot | `~/lilbot/workspaces/<bot id>`, the working directory of its chats |
| Conversation: one main conversation per bot; a new session replaces it as the main one | the engine | Hermes sessions; LilBot's database names the main one |
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
user's message automatically, holding a turn's writes until the turn succeeds, and saving before Hermes compresses
a conversation (`on_pre_compress`).

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
- Opening a chat loads its whole history. A long-lived conversation needs paging and stable item ids
  (Hermes: `omit_messages` on resume plus `session.transcript`).
- Chats made before slice 3 are not a bot's main conversation; they are still in Hermes.

## Rules

- Do not fork or patch Hermes. Configure it, or build on its API.
- The attach ticket and anything under `~/.hermes` that holds credentials are never printed, logged or committed.
- Test on a second server (`LILBOT_PORT=3371 LILBOT_DATA_DIR=<tmp> LILBOT_WORKSPACES_DIR=<tmp> bun server/main.ts`)
  with temporary bots, never Oscar's real bots, and
  delete them afterwards with `hermes profile delete <id> -y`. Set `LILBOT_SKIP_MEMORY_SETUP=1` on a test
  server that imports real profiles so start-up does not change their memory plug-ins or endpoints.
  Always set `LILBOT_BOT_IDS` to a temporary profile allowlist (or an unmatched sentinel before creating one):
  startup applies permission settings as well as identity. Never use an unrestricted test roster.
  Do not chat with or edit real bots on the test server.
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
- `bun live-checks/permissions-check.ts`: isolated second server; repairs a temporary profile from manual to off,
  runs a harmless recursive delete and file write, and checks no approvals remain. Deletes its profile and folders.
- `bun run check:routines`: isolated routine create/run/open/pause/restart/resume/delete check.
- `bun run check:memory`: connects a temporary bot to a throwaway memory, tells it facts, checks a new session knows
  them, prints tokens per turn, then deletes it. Inherited memory is disconnected before the baseline turn. A few model calls.
- `bun run start`: run the server. `LILBOT_PORT` and `LILBOT_HOST` override the defaults.
- `bun run dev`: Vite with hot reload, proxying `/ws` to a server on 3370.
- After a change: `bun run verify && systemctl --user restart lilbot.service`.
