# LeBot

Read `~/code/home/AGENTS.md` first (machine roles, shared rules). This file holds only what is specific to this repo.

## What this is

Oscar's own bot app, in the style of Grok Bot: one place to chat with and manage his bots. Single user. Runs on the
leader. Hermes is the engine: LeBot never runs a model or an agent loop, it is a client of the Hermes gateway.

North stars: Anthropic's "Building always-on agents" (inbox, timers, memory, permissions, outbox) and DeepSeek
Harness's "Super-agent" post (router and workers, event-driven, watchdog). Use what Hermes already provides for these
before writing our own.

## Status

Slice 2 done: the bot is the core object. Bot list, create bot, bot settings (name, function, instructions, model),
and a chat per bot with live tool rows, stop, and resume after reload or reconnect. Abilities (skills, toolsets, MCP
servers) are shown read-only. Next: the bot foundation (see Known gaps), then the Grok Bot style layout, delete a bot,
edit abilities, routines and skills screens, then teams and the router/worker pattern. Desktop (Tauri) and iOS (Expo) come after the web app.
Approvals are off in Hermes by Oscar's choice, so there are no approval cards.

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
- `server/client-session.ts`: one per browser connection. Validates requests, runs them on the engine, forwards
  chat events. The server stores nothing; bot and chat data lives in the engine. The one thing kept outside it is
  each browser's pointer to a bot's current chat (`localStorage`).
- `server/socket-guard.ts`: who may open the socket (allowed Host names plus same-origin). The tailnet name is set
  in the service's `LEBOT_ALLOWED_HOSTS`, not in code.
- `web/`: `lebot-socket.ts` (connection), `bots/` (store, sidebar, form, create and settings pages), `chat/`
  (state, hook, page), `router.tsx` (routes and the phone/desktop shell).
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
| Workspace: one folder per bot on the shared computer | the bot | proposed: the profile's `workspace/` folder, passed as the chat's working directory |
| Conversation: one main conversation per bot is the target; starting a new session is allowed for now | the engine | Hermes sessions; LeBot names which one is the bot's main conversation |
| Memory | the bot | Hermes: `memories/MEMORY.md` and `USER.md` per profile |
| Avatar, section, pinned, hidden, unread | the user | proposed: LeBot's own `bun:sqlite` database (awaiting Oscar's yes) |

- "Workspace" means exactly this: each bot has its own folder on the shared computer. It is not a level above bots.
  All bots share one machine (the leader); other machines come later as execution environments.
- Long conversations are the engine's job, and Hermes already does it: it compresses the conversation
  automatically at 50% of the model's context (silently, with a separate model), loads the two memory files into
  every run (about 800 and 500 tokens), reminds the bot to save memories every 10 user turns, and runs a background
  review that writes memories and skills. LeBot builds none of this; it shows it and lets Oscar edit it.
- Sidebar state belongs to the user, not the bot: pin, section, read/unread and hide are independent settings.
- A bot's live state (running, writing, waiting, current activity) is separate from unread and from the health of
  its computer.

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

## Known gaps (from the 2026-11-16 review, to settle before the UI round)

- The current chat of a bot is a pointer in each browser, so two devices see different conversations. Target: the
  engine names the bot's main conversation, and "new chat" is an explicit action.
- Chat and settings are sibling routes, so opening settings closes the chat. A details panel beside the chat needs
  `/bots/$botId` to become a layout route, and chat state to move from the chat component into a store.
- The server can only push per-chat events. Roster previews, unread and working markers need a bots event.
- `ui_meta.lebot` on the Hermes profile is written as one whole value and holds only the name. The user's own data
  (avatar, section, pin, hidden, unread) should not go there; see Foundation model.
- Chats do not run in the bot's workspace folder yet: no working directory is passed when a chat is created.
- `shared/bot-schema.ts` describes abilities in Hermes terms (toolsets, skills, MCP servers). Make it one neutral
  list before building the abilities editor.
- Opening a chat loads its whole history. A long-lived conversation needs paging and stable item ids.

## Rules

- Do not fork or patch Hermes. Configure it, or build on its API.
- The attach ticket and anything under `~/.hermes` that holds credentials are never printed, logged or committed.
- Test on a second server (`LEBOT_PORT=3371 bun server/main.ts`) with temporary bots, never Oscar's real bots, and
  delete them afterwards with `hermes profile delete <id> -y`.
- Each slice ends with a real check against the running service: `bun run verify`, `bun run check:live`, then drive
  the page in a browser.
- Logic that can be tested without a browser or Hermes gets a test in `tests/` in the same change.
- Keep docs in this file. Replace outdated text; do not append history.

## Commands

- `bun run verify`: lint, typecheck, unit and contract tests, and build the web app into `dist/`. `bun run format`
  applies formatting.
- `bun run check:live`: creates a temporary bot in Hermes, chats, stops, resumes, then deletes it. A few model calls.
- `bun run start`: run the server. `LEBOT_PORT` and `LEBOT_HOST` override the defaults.
- `bun run dev`: Vite with hot reload, proxying `/ws` to a server on 3370.
- After a change: `bun run verify && systemctl --user restart lebot.service`.
