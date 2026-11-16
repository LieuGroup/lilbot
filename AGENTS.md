# LeBot

Read `~/code/home/AGENTS.md` first (machine roles, shared rules). This file holds only what is specific to this repo.

## What this is

Oscar's own bot app, in the style of Grok Bot: one place to chat with and manage his bots. Single user. Runs on the
leader. Hermes is the engine: LeBot never runs a model or an agent loop, it is a client of the Hermes gateway.

North stars: Anthropic's "Building always-on agents" (inbox, timers, memory, permissions, outbox) and DeepSeek
Harness's "Super-agent" post (router and workers, event-driven, watchdog). Use what Hermes already provides for these
before writing our own.

## Status

Foundation done (slice 3): LeBot's own SQLite database for the user's data, a workspace folder per bot, one main
conversation per bot that is the same on every device, and the layout groundwork (chat stays open beside a details
panel, the server pushes roster changes). On top of slice 2: bot list, create bot, the Setup panel (name, function,
instructions, model, workspace, abilities read-only), chat with live tool rows, stop, and starting a new session.
Memory (slice 4): LeBot's own memory system with a Memory panel; new bots use it from their first session, an
existing bot is connected from its Memory panel. Hermes' default bot (Chief of Staff) is a test bot Oscar does not
use: nothing about it needs protecting.
Next: the Grok Bot style roster and details panel (sections, pin, hide, avatars, unread, Activity and Library
tabs), the nightly memory tidy-up, delete a bot, edit abilities, routines.
Desktop (Tauri) and iOS (Expo) come after the web app. Approvals are off in Hermes by Oscar's choice, so there are
no approval cards.

## Stack

TypeScript on Bun. No Effect, no server web framework, no ORM. Oscar does not write code: optimise for agents and
for behaviour he can check in the app. Keep an eye on speed and memory; measure before optimising.

- Server: plain `Bun.serve`. Database, when first needed: `bun:sqlite` directly.
- Web: React + Vite, TanStack Router, Tailwind 4, Zustand, Zod. Small shared parts live in `web/src/ui/`; add
  shadcn components (on Base UI) when a part needs real behaviour, such as a dialog or menu.
- Checks: Biome, `tsc`, `bun test`, Vite build, all through `bun run verify`. `bun run check:live` is the live
  check against the running Hermes.

## How it works

- `shared/`: LeBot's own definitions, used by server and web. `bot-schema.ts` (Bot), `chat-schema.ts` (chat items
  and events), `protocol.ts` (the browser-server methods, checked with Zod on the server).
- `server/engine/bot-engine.ts`: the interface an engine must satisfy. Nothing outside `server/engine/hermes/` may
  know about Hermes, so another engine (for example one speaking ACP) can be added without touching the web app.
  The one exception is `server/main.ts`, which picks the engine.
- `server/engine/hermes/`: Hermes as the engine. A bot is a Hermes profile (the bot id is the profile id; LeBot's
  display name is stored in the profile's `ui_meta.lebot`). A chat is a Hermes session. Bot management uses one
  shared gateway connection on the default profile; each open chat has its own connection for its bot's profile,
  because Hermes binds sessions to the profile the connection was attached with (checked live: another profile's
  session is refused with `profile_mismatch`). Sessions use Hermes' canonical methods (`x-canonical-methods` in
  the contract); profiles and models use the general `methods` table. Each connection starts with a
  single-use ticket from `hermes gateway attach --json` (about one second, the slowest step in opening a chat).
- `server/bot-service.ts`: what LeBot does with bots, whichever client asks. It joins the three owners of a bot:
  the engine (identity, setup, chats), the user's preferences (`server/db/`) and the bot's workspace folder
  (`server/workspaces.ts`). It decides which chat is a bot's main conversation. Layers, top to bottom:
  `client-session.ts` (transport) -> `bot-service.ts` -> engine and stores. Keep it that way.
- `server/client-session.ts`: one per browser connection. Validates requests, runs them on the service, forwards
  chat events. A typed handler map: a protocol method without a handler does not compile.
- `server/db/`: LeBot's own SQLite database (`bun:sqlite`), by default `~/.local/share/lebot/lebot.db`
  (`LEBOT_DATA_DIR`). It holds only what belongs to LeBot and the user: sidebar preferences, sections, and each
  bot's main-conversation pointer. Never copy into it what the engine stores. `database.ts` owns the schema as an
  ordered list of migration steps (add a step, never edit a shipped one); each store file owns the SQL of its tables.
- Workspaces: one folder per bot under `~/lebot/workspaces/<bot id>` (`LEBOT_WORKSPACES_DIR`), created on first use
  and passed to the engine as the working directory of new chats. A resumed chat keeps the folder it was made with.
- The server pushes `bots.changed` to every connected browser when a bot, a preference or a section changes, or
  when Hermes reports that sessions or skills changed. Browsers answer by fetching the bot list again.
- `server/socket-guard.ts`: who may open the socket (allowed Host names plus same-origin). The tailnet name is set
  in the service's `LEBOT_ALLOWED_HOSTS`, not in code.
- `web/`: `lebot-socket.ts` (connection), `bots/` (store, sidebar, form, create page, Setup panel), `chat/` (pure
  state in `chat-state.ts`, per-bot store in `chat-store.ts`, lifecycle in `use-chat.ts`, the chat column),
  `memory/` (the Memory panel), `router.tsx`. `/bots/$botId` is a layout route: the chat column stays mounted and
  connected while panel routes under it (`setup`, `memory`) open and close. Panels use `ui/panel.tsx`. Add new panels as child routes. On a phone an open panel covers the chat.
- Hermes' wire contract lives in `~/.hermes/hermes-agent/apps/shared/src/gateway-contract.openrpc.json` and
  `tui_gateway/contracts/`. Read it before using a new method, and read only fields the contract declares (Hermes
  sends some undeclared extras; do not rely on them). Every method, parameter and field LeBot uses is listed in
  `tests/hermes-contract.test.ts`: add to it when you use a new one. It is Hermes' internal API: after every Hermes
  update run `bun run verify` and `bun run check:live`.
- Runs as the systemd user unit `lebot.service` on `127.0.0.1:3370`. Other devices reach it over the tailnet only
  (port 8443).

## Foundation model

What a bot is and who owns each part. Decided with Oscar on 2026-11-16 unless marked proposed.

| Part | Owner | Where it lives |
|---|---|---|
| Identity (name, function), instructions, model, abilities | the engine | Hermes profile |
| Workspace: one folder per bot on the shared computer | the bot | `~/lebot/workspaces/<bot id>`, the working directory of its chats |
| Conversation: one main conversation per bot; a new session replaces it as the main one | the engine | Hermes sessions; LeBot's database names the main one |
| Memory | LeBot | facts in LeBot's database; the engine reads and writes them through an adapter |
| Avatar, section, pinned, hidden (unread later) | the user | LeBot's own SQLite database |

- "Workspace" means exactly this: each bot has its own folder on the shared computer. It is not a level above bots.
  All bots share one machine (the leader); other machines come later as execution environments.
- Long conversations are the engine's job, and Hermes already does it: it compresses the conversation
  automatically at 50% of the model's context (silently, with a separate model), loads the two memory files into
  every run (about 800 and 500 tokens), reminds the bot to save memories every 10 user turns, and runs a background
  review that writes memories and skills. LeBot builds none of this; it shows it and lets Oscar edit it.
- Sidebar state belongs to the user, not the bot: pin, section, read/unread and hide are independent settings.
- A bot's live state (running, writing, waiting, current activity) is separate from unread and from the health of
  its computer.

## Memory

LeBot owns memory so it survives an engine change, can be shared between bots, and can be seen and corrected by
Oscar. Three layers:

1. `server/memory/memory-store.ts`: the `memory_facts` table and its full-text index. A fact has a kind (`profile`
   = lasting, `journal` = dated history), a scope (`bot` = only the bot that learned it, `shared` = all bots), an
   author (bot or user) and dates. "Forget" marks a fact; it is never erased, so history stays reviewable.
2. `server/memory/memory-service.ts`: the rules, engine-neutral and fully unit-tested. Default scope (profile facts
   are shared, journal entries stay with the bot; either can be overridden), who sees what, de-duplication, recall
   by search, and `contextBlock`: what a bot is shown before each turn (lasting facts, then its last 10 journal
   entries, within about 1,500 tokens; the rest is reachable by recall).
3. The engine adapter. `server/engine-api.ts` is a local HTTP endpoint (`/engine/memory/*`) for adapters on this
   machine: loopback only, no browsers, token from `<data dir>/engine-token`. The Hermes adapter is a memory
   provider plug-in in `engines/hermes/lebot-memory/` (Python, standard library only). It holds no data. It puts
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

Hermes keeps a plug-in's code loaded per profile folder until the gateway restarts. So after changing the plug-in:
bump `version` in `plugin.yaml` and `VERSION` in `__init__.py`, reconnect the bots, and restart the Hermes gateway
(`systemctl --user restart hermes-gateway`, between runs of its cron jobs). LeBot logs a warning when a bot calls
with an older adapter version. New bots are unaffected: a new folder loads the current code.

Measured on 2026-11-16 (`bun run check:memory`): a fact told in one session was known in the next from the block
alone, a correction replaced the old fact, a one-off request was not saved, and a turn sent about 29,600 tokens
with LeBot memory against 31,600 with Hermes' own. The check reads the bot's real system prompt for the rules;
asking a bot to describe its own instructions proved unreliable.

Known gap: Hermes' background review (a forked agent asking "anything worth saving?" every 10 user turns) only runs
with Hermes' built-in memory tool, which a connected bot no longer has. A connected bot saves only when it decides
to during a chat. To close it, LeBot needs its own after-turn review, run through the engine on a cheap model.

Not built yet: that review, the nightly tidy-up (merge duplicates, drop outdated facts), saving before Hermes
compresses a conversation (`on_pre_compress`), and showing forgotten facts in the app.

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
    Skills live in one shared folder. So Grok Bot shares files between bots by default; LeBot's folder per bot is a
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

- Unread and "working" markers in the roster need the engine's per-chat activity pushed to the server; today only
  an open chat reports it. Add a `last_read` column and an activity event when the roster is built.
- Opening a chat loads its whole history. A long-lived conversation needs paging and stable item ids
  (Hermes: `omit_messages` on resume plus `session.transcript`).
- A bot's display name is still stored on the Hermes profile (`ui_meta.lebot.name`), written as one whole value.
  Nothing else may be added there; the user's data goes in the database.
- Deleting a bot is not in the app. When it is added: refuse the default bot, delete through the engine, call
  `PrefsStore.forgetBot`, and decide with Oscar whether the workspace folder is kept.
- Chats made before slice 3 are not a bot's main conversation; they are still in Hermes.

## Rules

- Do not fork or patch Hermes. Configure it, or build on its API.
- The attach ticket and anything under `~/.hermes` that holds credentials are never printed, logged or committed.
- Test on a second server (`LEBOT_PORT=3371 LEBOT_DATA_DIR=<tmp> LEBOT_WORKSPACES_DIR=<tmp> bun server/main.ts`)
  with temporary bots, never Oscar's real bots, and
  delete them afterwards with `hermes profile delete <id> -y`.
- Each slice ends with a real check against the running service: `bun run verify`, `bun run check:live`, then drive
  the page in a browser.
- Logic that can be tested without a browser or Hermes gets a test in `tests/` in the same change.
- Keep docs in this file. Replace outdated text; do not append history.

## Commands

- `bun run verify`: lint, typecheck, unit and contract tests, and build the web app into `dist/`. `bun run format`
  applies formatting.
- `bun run check:live`: creates a temporary bot in Hermes, chats, stops, resumes, then deletes it. A few model calls.
- `bun run check:memory`: connects a temporary bot to a throwaway memory, tells it facts, checks a new session knows
  them, prints tokens per turn, then deletes it. A few model calls.
- `bun run start`: run the server. `LEBOT_PORT` and `LEBOT_HOST` override the defaults.
- `bun run dev`: Vite with hot reload, proxying `/ws` to a server on 3370.
- After a change: `bun run verify && systemctl --user restart lebot.service`.
