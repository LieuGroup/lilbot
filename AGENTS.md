# LilBot

Read `~/code/home/AGENTS.md` first (machine roles, shared rules). This file holds the rules and decisions specific to
this repo; detail needed in one area only lives in `docs/` and is linked from its section.

## What this is

Oscar's own bot app, in the style of Grok Bot: one place to chat with and manage his bots. Single user. Runs on the
leader. Hermes is the engine: LilBot never runs a model or an agent loop, it is a client of the Hermes gateway.

North stars: Anthropic's "Building always-on agents" (inbox, timers, memory, permissions, outbox) and DeepSeek
Harness's "Super-agent" post (router and workers, event-driven, watchdog). Use what Hermes already provides for these
before writing our own.

UI references (Oscar, 2026-11-19): screens follow nightly-labs' OpenBot's layout and behaviour until he says otherwise;
OpenMausBot and Grok Bot ([docs/grok-bot-reference.md](docs/grok-bot-reference.md)) are secondary. Everything is redrawn
in LilBot's own tokens, type scale and components, and Oscar approves each Paper design.

- nightly-labs OpenBot is PolyForm Noncommercial: work from the running app and screenshots only, never its source,
  assets, icons, artwork or wording.
- OpenMausBot is Apache 2.0 except `enterprise/`; its name, mascot and artwork are trademarks. Copying its code needs
  attribution and Oscar's OK, which he has not given.
- Grok Bot: copy structure and behaviour, never its artwork, names or text.

## Project map

The app is built around the bot, so the same names appear on every side: `bots`, `chat` (inside `bots` on the
server), `memory`, and one folder per feature.

```
shared/            What the server and the web app agree on. Definitions only, no logic.
  protocol.ts        every request the web app can make      <feature>-schema.ts   each feature's data
  avatar.ts          avatar shapes and colours

server/            The LilBot server (runs on the leader).
  main.ts            Start-up: reads settings, picks the engine, starts listening.
  app-services.ts    builds and connects the services below
  environment.ts     production/development guards        background.ts   guarded timer callbacks
  http/              How the outside reaches the server: browser session, socket guard, engine API, listeners.
  bots/              The bot: service, identity store, user preferences, workspaces, runtimes, deletion.
  activity/          live status and unread
  memory/            The memory system: rules, facts table, safety, after-chat review.
  history/           Conversation records, import checkpoints, paging and bot-scoped search.
  threads/           Bot-to-bot exchanges: delegation, temporary groups, files, control, transcripts and durable deliveries.
  routines/          App-owned schedules, run history and scheduler.
  webhooks/          Outside events: secret addresses, sender signatures, accepted deliveries and their runs.
  work/              The work board: items with "done" definitions, evidence and results, Oscar's answers, its skill.
  goals/             Oscar's outcomes: the bot's agreement, a measured target, the review routine and its reviews.
  library/           Delivered workspace files, metadata, safe reads and folder listings.
  attachments/       Incoming chat files, streaming uploads and durable message associations.
  skills/            The shared skills library, per-bot switches and each engine's "Include this engine's skills" switch.
  connections/       LilBot-owned connection to T3 Code for coding (bridge, sign-in, skill) and the keys and replies MCP endpoints share.
  system/            LilBot's own MCP server through which bots operate the app, and the note every bot gets about its system.
  computers/         Computer identities, key registration and durable command requests.
  devices/           Devices (one per browser or app install), what "my computer" means from each, and where each message came from.
  database/          LilBot's own SQLite file and its schema steps.
  deploy/            Verified restart, database copies, rollback watchdog and notices.
  engines/           Whatever actually runs the bots.
    bot-engine.ts        the contract every engine must fulfil
    hermes/              the Hermes engine and its plug-ins: the only place that knows Hermes exists

web/src/           The web app.
  app/               start-up, the routes, the connection to the server, styles
  bots/              roster, bot menu and its dialogs, create bot, details panel and its Setup tab
  chat/              the conversation
  history/           the conversation's earlier parts: paging, day lines, session dividers, its start
  attachments/       files in the composer and in sent messages, the drop area
  activity/, library/, memory/   their details tabs (Library is a placeholder)
  threads/           work between bots: the line in a conversation, the opened exchange or group, stop, "With other bots",
                     "Working together"
  routines/          the Activity tab's Routines card, one routine (in place of the panel), a run's transcript
  skills/            data client for a panel not built yet
  computers/         the Settings > Computers page (list, remove, add this computer, add by command line)
  devices/           this browser's device id and name, and the "This device" block on the Computers page
  deploy/            last deployment failure notice
  settings/          the Settings dialog
  ui/                shadcn/ui parts (ours to edit) and our own small shared parts built from them

helper/            The standalone computer helper client.
tests/             Automatic tests, in the same folders as the code they test.
live-checks/       Checks that talk to the real Hermes with a temporary bot.
docs/              Area detail linked from this file.
```

Rules that keep it this way:

- A request flows downward only: `http/` -> `bots/`, `memory/`, `routines/`, `threads/`, `webhooks/`, `attachments/`
  or `library/` -> `engines/` and `database/`. Nothing lower may import from something higher.
- Nothing outside `server/engines/hermes/` knows about Hermes, except `main.ts`, which picks the engine. A second
  engine is a second folder under `server/engines/`.
- A new feature gets its own folder name, used on every side (`server/<feature>/`, `web/src/<feature>/`,
  `shared/<feature>-schema.ts`, `tests/<feature>/`).
- A new client (desktop, iOS) is a new top-level folder beside `web/` that uses `shared/`.
- Files stay under about 200 lines and are named for what they do.
- `tests/structure.test.ts` fails when an import breaks these rules.

## Status

Built: roster, create bot, Setup panel (abilities read-only), chat with live tool rows, stop and new session, one
continuous main conversation per bot on every device, the three-column shell (roster, conversation, details panel with
Activity, Library, Memory and Setup tabs), bot menu, delete confirmation, Settings, chat attachments, LilBot's own
memory with a Memory panel and after-chat review, every bot knowing its system (the note) and operating the app through
LilBot's own MCP tools, delegation between bots (several tasks at once, files, status, stop, redirect, wait), temporary
groups of bots (rounds, a shared folder, an outcome; #133), the screens for asked threads, handed-over work and groups
(#65, #135, #136: the line or card in a conversation, the opened exchange or group, stop, "With other bots", the roster's
"Working together"), the Routines screens (#53), and the
backends for routines, webhooks, threads, library, skills, computers, the work board with its check levels, goals and
coding through T3 Code. Next: the Webhooks (#138), Library, work board and goal screens, the check levels' track record and
spot checks (#142), the nightly memory tidy-up and editing abilities. Reports are not built. Desktop (Tauri) and iOS (Expo) come after the
web app.

## Safety: production and development

Production is Oscar's daily app: `lilbot.service` on `127.0.0.1:3370`, running from `~/lilbot/release`, with data in
`~/.local/share/lilbot`, `~/lilbot/workspaces`, `~/lilbot/skills` and the `~/.hermes` gateway. Its unit sets
`LILBOT_ENV=production` (drop-in `environment.conf`); development setup never edits it. Hermes' default bot (Chief of
Staff, profile `default`) is Oscar's live bot.

- **Never test against production or any live bot, Chief of Staff included.** Never restart production as a check,
  and never chat with or edit a real bot from a test server. Every check runs on an isolated development server with
  temporary bots only. Production restarts only through `bun run deploy`.
- Before live checks run `bun run dev:setup` on the leader. It creates `~/lilbot-dev/` (`hermes/`, `hermes-locks/`,
  `data/`, `workspaces/`, `skills/`) and starts the separate `lilbot-dev-hermes.service` with explicit `HERMES_HOME`
  and `HERMES_GATEWAY_LOCK_DIR`. It waits for a ready gateway, keeps existing config and credentials, and is
  idempotent. There is no standing dev LilBot instance, network address or start at login. Stop the dev gateway when
  no checks need it: `systemctl --user stop lilbot-dev-hermes.service`.
- Every live-check entry, including a direct `bun live-checks/...` run, imports `scripts/dev-env.ts` first. It sets
  `LILBOT_ENV=development`, the dev engine home and locks, a loopback free port and throwaway directories under
  `~/lilbot-dev/runs/`. Never start an unconfigured server: startup requires an explicit `LILBOT_ENV`.
  `server/environment.ts` refuses production paths, ports and service targets in development and requires every dev
  directory under the dev home; production refuses test overrides (profile allowlists, skipped memory setup, test
  intervals, local Access certificate URLs).
- Development creates and binds only `dev-` engine profiles and checks the attach receipt's home before connecting.
  Production ignores `dev-` profiles, persisted bindings included.
- A test server always sets `LILBOT_BOT_IDS` to its temporary profile allowlist (or an unmatched sentinel before
  creating one): startup applies permission settings as well as identity, so never run an unrestricted test roster.
  Set `LILBOT_SKIP_MEMORY_SETUP=1` so start-up does not change memory plug-ins of existing profiles. Checks delete
  their profiles and folders in `finally`.
- Run live checks one at a time: Hermes plug-in admission reads the shared dev profile catalogue while plug-ins are
  added or removed. Hermes CLI calls pass `env: process.env` explicitly (Bun's default spawn environment can predate
  the initializer). `LILBOT_HERMES_BIN` selects the executable; never update the shared Hermes program to test a
  change.
- Dev has its own CLIProxy provider config (CLIProxy is on another host). `~/lilbot-dev/hermes/.env` (0600) holds
  only its named client-key variable, copied once from the production `.env`, loaded through `EnvironmentFile` and
  inherited by dev profile clones; calls share the upstream allowance. Never copy the whole `.env`, `auth.json`, MCP
  tokens or production T3 grants; authorize development T3 separately.

### Secrets

Never print, log or commit, and never put in a bot's instructions or memory: the Hermes attach ticket, anything under
`~/.hermes` that holds credentials, `<data>/engine-token`, `t3-grant.json`, `computer-server-key.pem`,
`~/.cloudflared/cert.pem`, the tunnel credentials, the Access drop-in, Oscar's email, webhook addresses and webhook
signing secrets. The database holds signing secrets (an address is computed from the engine token and a nonce, never stored), so
copies of data use private directories and files (0700/0600).

### Hermes

- Do not fork or patch Hermes. Configure it, or build on its API. Shipping a LilBot change never restarts Hermes or
  hand-edits live profiles.
- Its wire contract is `~/.hermes/hermes-agent/apps/shared/src/gateway-contract.openrpc.json` and
  `tui_gateway/contracts/`. Read it before using a new method, and read only fields it declares (Hermes sends
  undeclared extras; never rely on them). Every method, parameter and field LilBot uses is listed in
  `tests/engines/hermes/hermes-contract.test.ts`: add to it when you use a new one. It is Hermes' internal API: after
  every Hermes update run `bun run verify` and `bun run check:live`.
- Put nothing new into Hermes plug-ins. A new bot-facing tool goes on LilBot's own MCP server (`server/system/`), with the
  same service function the screen uses, so a second engine gets it for free; the plug-ins keep only what MCP cannot do.
- How LilBot maps onto Hermes (connections, plug-ins, importer, MCP): [docs/hermes-engine.md](docs/hermes-engine.md).
  What any engine must provide, as a checklist: [docs/engine-contract.md](docs/engine-contract.md).

## Stack

TypeScript on Bun. No Effect, no server web framework, no ORM. Oscar does not write code: optimise for agents and for
behaviour he can check in the app. Keep an eye on speed and memory; measure before optimising.

- Server: plain `Bun.serve`; database `bun:sqlite` directly.
- Web: React + Vite, TanStack Router, Tailwind 4, Zustand, Zod. The UI is built on shadcn/ui (Base UI variant,
  `components.json`) and its AI Elements patterns:
  - Never hand-write a part shadcn has (button, input, menu, dialog, ...). Add it with `bunx shadcn@latest add
    <name>`; it lands in `web/src/ui/` (alias `@/ui`). Then run `bun run format`. Delete exports nothing uses so the
    file stays under about 200 lines. The code is ours: edit it when needed.
  - A chat feature first looks for its AI Elements pattern: read
    `https://ui.shadcn.com/docs/ai-elements/base/<name>.md` (Chat, Message, Prompt Input, Tool, Task, Queue, Model
    Selector, ...), add the parts it lists, and compose them in the feature's folder. Patterns take plain props: map
    our own data to them at the component edge (`chat/chat-item.tsx`), never reshape `chat-state.ts` or `shared/` for
    a library, and never add the Vercel AI SDK. Next to adopt, when their feature exists: Context, File Tree,
    Confirmation, Subagent, Plan, Sources.
  - Colours: only shadcn's token names (`bg-background`, `bg-card`, `bg-muted`, `text-muted-foreground`,
    `bg-primary`, `text-destructive`, `border`), plus `success` for green and `hairline` (foreground at 8%) for the
    line between columns and around cards. Other tints are the foreground at an opacity (`bg-foreground/4` hover,
    `/6` pressed). Accent blue (`primary`) is only for the unread dot and the working spinner; switches and primary
    buttons are ink (`bg-foreground`). They are defined once in `app/styles.css` with LilBot's palette; dark mode
    follows the device (`prefers-color-scheme`). Bot replies use the `prose-chat` utility defined there.
  - Font: Inter, bundled in `app/fonts/` (three subsets, about 48 kB for English text, loaded by the browser as
    needed), so the app looks the same on every device; the device's own font shows while it loads.
  - Type scale, closed: 12 meta and section labels, 13 previews and menus, 14 names, 15 chat text, 16 panel and
    dialog titles. Weights 400, 500, 600. Icons 16px at stroke 1.75 in 28px buttons (`ui/icon-button.ts`).
  - Bundle budget: the chat's first load stays about 220 kB of JavaScript and 17 kB of styles (gzip -9, counting every
    file `dist/index.html` references; Vite's per-file sizes alone understate it). So feature code imports parts as
    `@/ui/<part>`; pages with forms are lazy routes in `app/router.tsx`; details tabs are lazy chunks in
    `bots/bot-details-panel.tsx`; the bot menu, its dialogs and Settings are lazy (the roster only writes to small
    stores and loads them on hover or first use); so is the composer's model menu (the pill writes to
    `bots/model-picker-target.ts`); the image viewer loads on the first click on an image.
  - `bun run build` also writes brotli and gzip copies of `dist/` text files; `server/http/static-files.ts` serves the
    accepted encoding to every listener that serves the app, hashed `/assets/` files as immutable (a missing one is a
    404, never the page) and `index.html` as `no-cache` with an ETag.
- Checks: Biome, `tsc`, knip (unused files, exports, dependencies), the 200-line file limit, `bun test`, Vite build, all
  through `bun run verify`.

## Listeners and trust boundaries

All three listeners bind loopback (the private app's `LILBOT_HOST` defaults to `127.0.0.1`), disable development
error pages and answer errors with a plain 500.

- **Private app** (`LILBOT_PORT`, production 3370): the app, browser routes, `/ws` and the engine API. Other devices
  reach it over the tailnet only (port 8443). `server/http/socket-guard.ts` allows Host names from
  `LILBOT_ALLOWED_HOSTS` (set in the service, not in code) plus same origin. It refuses `cf-connecting-ip`, `cf-ray`
  and Cloudflare `cdn-loop` headers before routing, even with a valid Host.
- **Helper door** (off by default; `LILBOT_PUBLIC_ENABLED=1`, `LILBOT_PUBLIC_PORT`, production 3372, must differ from
  the private port): only POST `/helper/register` (8 KiB bodies), GET `/helper/connect` (WebSocket) and POST
  `/hook/<address>` (webhook deliveries, 256 KiB bodies; see Webhooks). No app, browser socket or engine endpoint.
  Behind Cloudflare the client address is `cf-connecting-ip`.
- **Access listener** (off by default): `LILBOT_ACCESS_ENABLED=1` and all of `LILBOT_ACCESS_PORT` (3373, distinct
  from the other two), `LILBOT_ACCESS_HOST` (hostname, no scheme or port), `LILBOT_ACCESS_TEAM`
  (`<team>.cloudflareaccess.com`, no scheme), `LILBOT_ACCESS_AUD` and `LILBOT_ACCESS_EMAIL` (service environment
  only). Missing or invalid settings
  stop startup before any listener opens. It serves the same app, browser routes and `/ws` as the private app.
  - Every HTTP request and socket handshake needs an RS256 Access JWT in `Cf-Access-Jwt-Assertion`; only `/ws`
    upgrades also accept the `CF_Authorization` cookie, and a present header wins over a cookie.
  - It checks the configured issuer, audience, expiry/not-before (30 seconds of skew) and email (case-insensitive).
    Keys come only from `https://<team>/cdn-cgi/access/certs`, cached ten minutes; an unknown key triggers a refresh
    after a 30-second cooldown, and failed fetches have the same cooldown.
  - Invalid or missing tokens, a wrong Host or a mismatched Origin get a plain 403. Tokens and the email are never
    logged. `/engine`, `/engine/*`, `/helper` and `/helper/*` are always refused, even with a valid JWT.
  - `LILBOT_ACCESS_TEST_CERTS_URL` exists only for `check:access` (HTTP on `127.0.0.1`, all three isolation
    directories, exactly `LILBOT_BOT_IDS=isolation-access-check`). Never set it in deployment.
- Never add the helper or Access hostname to `LILBOT_ALLOWED_HOSTS`, and never point a tunnel at the private port.
- File downloads (library, attachments, files passed between bots, helper installers) apply the socket's Host/Origin checks, refuse cross-site
  fetches and send attachment disposition, no-sniff, sandbox and no-store headers. They exist on the private and Access
  listeners, never on the helper door.
- **Engine API** (`server/http/engine-api.ts`, `/engine/*` on the private listener): for engine plug-ins on this
  machine. Loopback only, no browsers, token from `<data>/engine-token`. A plug-in acts as one bot through the
  bot-bound capability in its profile settings: the server takes the caller from that capability, ignores bot ids in
  request bodies, and refuses unknown and deleted bots, including the bot behind a creation capability. The bot
  tools still on the plug-ins (memory, skills, computers, conversation search) go through it, and so do the
  routes kept for sessions that loaded an older adapter (`bots/create`, `routines/*`, `threads/*`, `library/give`);
  the T3 bridge and LilBot's own MCP server use their own per-bot keys (see Coding and System).
- **Cloudflare:** both public names run through LilBot's own `lilbot-connect` tunnel. `~/.cloudflared/cert.pem` lets
  agents manage LilBot's own DNS names and tunnels; touch only LilBot's own tunnels and names, the account holds
  others. Hostnames, ingress, outside checks and rollback: [docs/cloudflare.md](docs/cloudflare.md).

## Foundation model

What a bot is and who owns each part.

| Part | Owner | Where it lives |
|---|---|---|
| Identity (name, function), instructions, model, reasoning effort, permission mode, engine binding | LilBot | `bots` table in LilBot's database |
| Skills and per-bot skill switches | LilBot | shared skills library and SQLite |
| Tools and MCP connectors | the engine, except LilBot's own two connections: T3 Code and the system server | Hermes profile; defined in `server/connections/` and `server/system/` |
| Workspace: one folder per bot on the shared computer | the bot | `~/lilbot/workspaces/<bot id>`, the working directory of its chats |
| Conversation: continuous history, with one active session | LilBot record; engine working context | SQLite history items and session dividers; Hermes keeps model context |
| Memory | LilBot | facts in LilBot's database; the engine reads and writes them through an adapter |
| Primary bot, avatar, section, pinned, hidden, unread | the user | LilBot's own SQLite database |

- A bot has no type, role or template. Its `function` is a short roster description, not a category. Instructions
  define what makes bots different; every bot has the same skills and tools by default.
- Each bot has one permission mode, stored with its identity: `full-access` by default. The protocol names
  `approval-required`, `auto-accept-edits`, `auto` and `full-access`; only full access is supported now. Engines declare
  supported modes, and unsupported choices fail before saving. LilBot applies the mode on creation, once per bot at
  startup, on mode changes, chats and reviews, repairing drift. Routine runs currently use full access (`yolo`); when
  other modes exist, routine and webhook runs must use the bot's mode. There are no approval cards. LilBot bots do not
  follow the home rule requiring approval for App Store Connect or submissions to Apple. They may still ask task
  questions, and engine hard stops remain.
- The user chooses one primary bot (in Setup) and can still talk to any bot directly. The choice lives in LilBot's
  database, defaults to the engine's default bot, and falls back to it if the chosen one disappears. Changing it only
  moves the mark. The roster puts it first; app entry opens its conversation. Bots answer whoever gave them the work:
  Oscar in that chat, another bot in their shared thread. Nothing routes to the primary automatically; extra
  knowledge for the primary is not decided.
- Any bot creates bots when asked (`lilbot_bot_create`; the plug-in's `create_bot` ended with adapter 0.11.0): LilBot ignores caller ids and models in the
  arguments. The caller writes the instructions and function; the new bot inherits its model. Request ids prevent duplicate creation, including concurrent retries and server restarts. The bot appears at
  once; a hidden first prompt starts its main conversation with its own greeting and task suggestions, which normal
  activity observation marks unread. The caller returns a link. The app's create form stays available.
- "Workspace" means exactly one folder per bot on the shared computer, not a level above bots. All bots share one
  machine (the leader); other machines are execution environments (see Computers).
- Long conversations are the engine's job: Hermes compresses the conversation at 50% of the model's context (silently,
  with a separate model), loads two memory files into every run, reminds the bot to save memories every 10 user turns
  and runs a background review. LilBot builds none of this and never summarises; it shows it and lets Oscar edit it.
- Sidebar state belongs to the user, not the bot: pin, section, read/unread and hide are independent settings.
- A bot's live state (running, writing, waiting, current activity) is separate from unread and from the health of its
  computer.

## How the server works

- `server/bots/bot-service.ts` is what LilBot does with bots, whichever client asks. It joins LilBot's identity
  (`bot-store.ts`), the engine (abilities and chats), the user's preferences (`bot-prefs-store.ts`) and the bot's
  workspace (`workspaces.ts`). Layers, top to bottom: `http/browser-session.ts` (transport) -> `bots/bot-service.ts`
  -> engine and stores. `browser-session.ts` is a typed handler map: a protocol method without a handler does not
  compile.
- `bot-runtimes.ts` resolves the engine binding and applies saved identity. Runtime availability and abilities are
  cached at startup and refreshed on creation, updates, memory connection and observed profile disappearance/return.
  Roster and detail reads use that snapshot and database identities, with `runtimePending` until preparation
  finishes; they never wait for engine calls, profile preparation, memory refresh or the activity observer.
- Start-up preparation (`bots/runtime-readiness.ts`) is one flight per bot: permissions, tools (computers, skills,
  connections), then identity. The server prepares the primary bot first, the rest five at a time after a short
  head start, in the background. A chat, review or routine waits only for its own bot's flight (`BotRuntimes.use`),
  never the roster. A bot whose preparation fails settles as unavailable, never `runtimePending`, and is retried
  after 5 s, 15 s, 45 s, then every two minutes until it is ready or deleted; one bot's failure never stops another's.
  Every settle pushes `bots.changed`. `initialize()` rejects only when the one-time import fails.
- Every start-up pass that touches engine profiles (permissions, memory refresh, skills, connections), and memory
  connection, uses only the non-deleted database bindings, by native id, never all engine profiles. Only the one-time
  import into a new database needs engine discovery. That import is atomic and idempotent: existing bots keep their
  profile ids. New bots get UUIDs independent of their native runtime ids. A missing runtime stays in the roster as
  unavailable; its identity and memory stay in LilBot.
- Identity is imported once, then LilBot wins on mismatch. Model edits are checked against the engine's available
  models before anything is saved, also when repairing a bot with an invalid saved model; unsupported permission
  modes fail before saving. Accepted edits are saved in the database before they are applied to the runtime.
- Model and reasoning effort (`bots/bot-session-settings.ts`, details in [docs/hermes-engine.md](docs/hermes-engine.md)):
  the effort is `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` or unset (the engine's default; `ultra` is
  not offered). It is saved with the bot, one per bot, kept as chosen when the model changes, and an unknown level is
  refused before saving. `models.list` keeps `models` and adds `capabilities` per model (`reasoning`,
  `canDisableReasoning`: null when the engine does not say, so hide "Off" only for false).
  - An edit to model or effort is saved, then applied to the bot's main conversation with `session.mutate`
    (`BotEngine.updateSession`), so it takes effect from the next message, also while a turn runs: the running turn
    finishes as it was. Edits to one bot run in order. An effort for a model that does not reason stays saved and is not sent.
  - Every session LilBot creates for the bot starts with its effort: chats, routine runs and bot threads (a session that is
    resumed keeps its own). The memory review keeps its own model and gets none.
  - `effectiveReasoningEffort` on the bot is what the engine says it sends for the main conversation (null: none). It is
    kept in memory from the session when a chat opens, after an edit and from `session.info` events, never read on demand,
    and absent until the engine has reported it. Null cannot tell "off" from the engine's default (both are sent as no
    level): read it with `reasoningEffort`.
  - The engine can hold a conversation's switch back (a conversation of 100,000+ tokens, an expensive model, a data
    policy) until its own confirmation: `bots.update` then answers `confirm_required` after saving (the same edit's
    effort still applies), the choice stays saved for new conversations and the conversation keeps its model. That
    refusal is not retried by later edits. The engine's confirmation token comes back only in undeclared fields of
    `session.mutate`'s result (checked live, #79), so LilBot never confirms; picking the model does not override the
    guard. The first message after a switch has no prompt cache.
- `server/database/migrations.ts` owns the schema as an ordered list of migration steps (`database.ts` opens the file
  and applies them): add a step, never edit a shipped one. Each store file owns the SQL of its tables. Default file
  `~/.local/share/lilbot/lilbot.db` (`LILBOT_DATA_DIR`). SQLite connections wait up to five seconds for short locks.
- Workspaces: `~/lilbot/workspaces/<bot id>` (`LILBOT_WORKSPACES_DIR`), created on first use and passed to the engine
  as the working directory of new chats. A resumed chat keeps the folder it was made with.
- Pushes: `bots.changed` goes to every browser when a bot, preference or section changes, or the engine reports that
  sessions or skills changed; browsers fetch the list again. Each feature has its own `<feature>.changed` push.
- Activity (`server/activity/`): live per-session status and durable per-bot unread, in `bots.list` and pushed with
  `bots.changed`. Opening a chat marks its bot read, and any connected viewer keeps it read until the chat closes.
  Finished/failed settles after eight seconds. Replay cursors stop old replies becoming unread again after a restart.
  Unread turns on for a reply, for a session that starts waiting for Oscar and for one that fails, with or without text,
  unless he is viewing; an engine repeating the same waiting/failed status with a later event does not turn it on again
  (`ActivityService.needsOscar`). Hidden memory reviews are excluded. `LILBOT_BOT_IDS` restricts the engine to a
  native-profile allowlist; runtimes created on that server join it.
- Background timers (`background.ts`) catch failures and retry on later ticks; their logs carry
  fixed task labels, never exception payloads. A persistent database failure logs and leaves work pending rather than
  stopping the server.

### Deleting a bot

`bots.delete` takes optional `files: archive | delete` and `privateMemories: forget | keep`; defaults (archive,
forget) are kept with `bots.deleteDefaults.get/set`. The primary bot and the engine's default bot cannot be deleted.

- `bot-deletion.ts` saves a tombstone with the name and choices before teardown, removes the runtime through its
  native binding, then the workspace, memory, preferences, activity and queued reviews. Retrying the same id finishes
  incomplete cleanup with the original choices. Deletion clears the creation marker and removes the profile settings
  that hold its capability and memory binding.
- A tombstoned bot's capability is refused at once, even while teardown retries; creation retries cannot revive it;
  late activity and memory calls are ignored or refused; uploads, attachment reads and library access stop at once.
  Tombstones stay out of the roster.
- Removed: conversation record and journal (whatever the choices), routines and webhooks with their run history (a
  tombstoned bot cannot dispatch, and its webhook addresses answer 404 at once), skill off switches; its active
  computer requests are cancelled.
- Files: archived to `<workspaces>/.archive/<bot id>` without following links, or deleted; attachments follow the same
  choice.
- Kept: shared facts; private facts unless forgotten (`memory.list` still shows a tombstone's facts for attribution
  and restoration); library and attachment metadata (the bot loses access); thread records with the names captured
  at creation; work items and goals with the owner's name (unfinished ones are dropped: "The bot was deleted."); skills it wrote,
  with their authorship; the log of changes bots made through the system server (with the name the bot had).

## Web app

Visual specs (sizes, copy, Paper frames): [docs/screens.md](docs/screens.md).

- Shell: on a wide screen three columns: roster, conversation, details panel. The roster search filters names and
  functions, hidden bots included. On top, tiles, only once a bot is pinned: the primary bot with a star, then pinned
  bots in pin order (`pinnedAt` from `bots.list`, the same on every device), sharing the width at most three to a line;
  a pinned bot leaves its section, and a hidden one stays in Hidden. With nothing pinned, the primary is an ordinary
  first row. Then the user's sections, then collapsed "Unassigned" and "Hidden" groups (with no sections, bots are
  listed plainly). The group holding the open bot stays open; open groups are remembered per browser. Grouping is
  `bots/roster-groups.ts`.
- Rail: on a wide screen the roster collapses to a 64px rail of avatars in the same order (closed groups left out),
  remembered per browser (`bots/roster-view.ts`); the rail is a lazy chunk. Phones never show it.
- Bot menu (`bots/bot-menu-rules.ts` decides the items): opened from a row's or tile's "more" button or a right-click
  on a row, tile or rail avatar. The
  primary bot's menu has only Mark as read/unread, Name and avatar and "Change primary bot" (a submenu of the other
  bots; only the mark moves): it is always the first tile, so pin, section and hide would change nothing, and it cannot
  be deleted. The engine's default bot has no Delete.
- Delete dialog: starts from `bots.deleteDefaults.get`, read on every open; "Change defaults" closes it and opens
  Settings on Bots; deleting the open bot returns to the app's start.
- Details panel: each tab is the route `/bots/$botId/$tab`; `/bots/$botId` is a layout route, so the chat column stays
  mounted and connected while tabs open, change and close. At 1280px and wider the panel opens on Activity by itself
  unless the user closed it (remembered per browser); opening another bot keeps the open tab. On a phone it opens
  only from the toggle and covers the chat. To add a tab: an entry in `DETAILS_TABS` (`bots/details-tabs.ts`) and a
  lazy entry in `tabContent`, whose component takes `{ botId }` and wraps its body in `ui/panel.tsx`.
- Avatars: ten vector cover shapes and twelve colours for cover and face. Shape and cover default from the bot's id;
  a missing face colour reads as ink without rewriting the row. Create and the bot menu's "Name and avatar"
  (`bots/edit-avatar-dialog.tsx`) use the same three picker rows.
- Model picker: a pill in the composer after the attach button shows "model · Effort", or the model alone for a model
  the engine says does not reason (`bots/model-pill.tsx`); it opens the Model Selector menu upward (`bots/model-menu.tsx`,
  a lazy chunk): "Find a model" (Base UI's menu filter), models grouped by provider with a tick on the current one
  (`ModelChoices`, shared with Setup's field), then a "Reasoning effort" row with a submenu (`bots/effort-choices.tsx`:
  Default, Off, Minimal to Max for every reasoning model; "Off" hidden when `canDisableReasoning` is false, marked "if the
  model allows" when null), and "Changes <bot>'s model and effort, from the next message." Choosing saves at once with
  `bots.update`, also while the bot works; the pill shows a spinner meanwhile, a refusal puts the saved value back with a
  red note in the composer. When the engine sends another level than the one chosen (`effectiveReasoningEffort`) the pill
  shows an info mark and the row reads "<chosen>, sent as <sent>"; never for Off against Default, which the engine reports
  alike (`bots/reasoning-effort.ts`). A switch the engine holds back (`confirm_required`) keeps the saved choice and shows a
  plain note: "This long conversation keeps its model until New session; new conversations use the new one." The saved
  model reads "Choose a model" in red only once `models.list` has loaded without it. The engine's list is fetched once per
  connection (`bots/model-list.ts`). Setup shows the same model and effort (with "Sent as ..." under it) and reloads when
  they change.

### Routines (`web/src/routines/`, #53)

Visual specs: "Routines" in [docs/screens.md](docs/screens.md).

- They live in the Activity tab ("Routines" card, in its lazy chunk); there is no Routines tab and no form: routines are
  made by asking the bot. `routines/routine-store.ts` reads `routines.list` (and `goals.list` to know which routine
  reviews a goal) for the bots on screen, again on `routines.changed`, `goals.changed` and reconnect. Wording is
  `routines/routine-lines.ts` only (pure, tested).
- A row opens one routine with `?routine=<id>` on `/bots/$botId`: it replaces the whole details panel (avatar and tabs
  included) on the Activity tab, as a lazy chunk; changing tab or closing the panel drops it. The switch pauses and
  resumes (`routines.pause`/`resume`, shown at once and put back on refusal); the bin asks first, then `routines.delete`.
- A goal's review routine (a goal whose `routineId` is this routine) says "For your goal" and shows the goal's words. It
  has no switch and no Delete: LilBot's goal tick puts its state back within seconds (see Goals), so a control would
  silently undo itself. It follows the goal.
- A run row opens its transcript with `?run=<id>`, the same column swap as an opened exchange (one of the two at a time):
  the conversation stays mounted, `invisible` and inert. The run's chat (`routines.openRun`) is kept in the view's own
  state, never the bot's chat slot, followed live while it runs, and closed (`chat.close`) when the view goes. Its only
  user message is LilBot's wrapper prompt, so user messages are left out and "The routine asked" shows the routine's
  words. A run not started yet has no transcript and is not a link.

### Work between bots (`web/src/threads/`, #65, #135, #136)

Visual specs: "Work between bots" in [docs/screens.md](docs/screens.md).

- A `tool` item with `threadId` draws as a bordered line from the bot's `threads.list` (`threads/thread-store.ts`, read
  for the bots on screen and again half a second after `threads.changed`); an exchange not read yet, or a group, keeps
  the plain tool line. With a `batchId` it is a handed-over task, without one an asked thread; the delegating side is
  the first participant. Tasks of one batch share one card at the first line; the other lines draw nothing and their
  rows hide. Wording lives in `threads/thread-lines.ts` and, for groups, `threads/group-lines.ts` only.
- A group's line (`threads/group-line.tsx`) is drawn in the leader's and every member's conversation from that bot's
  `threads.list`, with its state from `group` (rounds, replies, how it ended); the wording for an end other than a close is
  LilBot's own, never the server's `end.outcome`. A group runs until `group.end` is set, whatever its status.
- The line, the opened view, the group view (loaded from the opened view), the stop dialog and "Working together"
  are lazy chunks; the chat's first load carries only the `ChatItem` switch, `?thread=` handling and the check whether
  any bot has `groups`.
- "Working together" (`threads/working-together.tsx`): the roster's top section and the rail's group slots, only while a
  bot in `bots.list` has `groups`. Members and the leader come from each bot's `groups`; a row opens
  `/bots/<leader>?thread=<group>`. Row states ("Leading a group", "In a group", "In a group · <activity>") are in
  `bots/row-state.ts`: a member's live activity in `bots.list` is what it does in its group (`groups[].activity`), else its usual `activity`, combined with its `groups`.
- Opening sets `?thread=<id>` on `/bots/$botId` (tab links and the panel's auto-open keep it with `search: true`). The
  view covers the conversation column while the conversation stays mounted, `invisible` and inert: its connection
  and scroll position are unchanged. On a phone, opening from the details panel goes to the conversation first.
  "Back to chat" drops the parameter; each bot button opens that bot's chat.
- Stop (a running task's or group's line and its view) asks first, then calls `threads.cancel`; asked threads have no
  Stop. Any participant's line can stop a group.
- Files passed in a group, and the files its leader kept, show as chips that download through the same route as an
  exchange's (`ThreadService.file`). A group closed before #178 has no recorded hash for its kept files, so their chips' links
  answer "File missing or unavailable" (the files are in the leader's Library).
- Oscar never writes in an exchange: no composer.

### Conversation scroll (AI Elements' Message Scroller)

- It opens at its latest message (also after a reload or resume). A sent message moves up and the reply grows below
  it (Oscar's choice); the list follows the reply only while the reader stays at the end.
- Only messages sent while the list is open are scroll anchors: the scroller jumps to any anchor it did not see arrive
  (`chat/scroll-anchors.ts`). Rows are counted by position in the conversation (`ChatView.first` plus the index), and
  each transcript load (`ChatView.load`) moves the end of what counts as arrived, so earlier parts loading above never
  become anchors.
- Rows are memoised and keyed by that position, so a streamed chunk redraws only the last row, an earlier part redraws
  none below it, and a reloaded transcript keeps unchanged item objects (`reuseItems` in `history/history-view.ts`).
- A chat this page has not shown appears from `chat.history` (a database read) while `chat.open` attaches; the message
  box takes typing meanwhile and sends once the chat is open. The list first draws the latest 20 rows, then the
  earlier ones in a transition that yields to typing; the view stays in place as they arrive above.
- Queued messages show as dashed bubbles, the activity line as a shimmering Trace line (not Reasoning: we get a
  status, not thinking text), tool use as Trace lines.

### Conversation history on screen (`web/src/history/`)

- The main conversation is one continuous history across sessions, built from the snapshot's `history` page; other
  chats, such as a routine run, show only their own transcript.
- It opens on its latest part. Scrolling within one screen of the top (or a conversation that fits the screen)
  fetches the next earlier part with `chat.history` and its cursor, one part at a time, drawn in a transition.
- The "Loading earlier messages" line is an overlay, never a row: the scroller keeps the reader's place only when the
  first row is still there and has moved down, so the first row is always a message while more can load.
- Day lines go between two rows on different local days, never above the earliest loaded row unless it is the very
  start. The very start shows only when the server sends `start` (import complete). While the import runs, a
  `history.changed` push for this bot, with the reader at the top, reads the earliest part again (at most every three
  seconds) and adds only rows older than those shown.
- New session: the header button adds a divider at once and keeps the conversation; the new session's snapshot
  replaces it with the saved divider.
- Reopening or reconnecting keeps earlier parts already loaded when the new latest part shares a row with them
  (`withLatest`); rows that arrived live are replaced by their saved copies. `MessageList` is keyed by bot, so a new
  session never remounts the scroller.

## Conversation history

`server/history/` owns the conversation record; Hermes owns the model's working context and LilBot never summarises.

- Streaming chat events are journalled before forwarding; when no browser is open, observer replay is journalled by
  epoch and sequence (user sends, tool rows, completion). A read-only background importer reconciles Hermes
  transcripts, including work done while LilBot was offline. Row ids are namespaced by engine and profile, and repeated
  pages upsert; tool results are keyed by their persisted tool call id. It is an append-only record: rewinds and resets
  never erase copied rows. Migration 19 rewinds import checkpoints once to backfill tool lines into existing copies,
  keeping every stored row.
- `bun run history:exclude -- --bot <id> --session <id> --reason "<text>" [--yes]` (operator only) permanently removes
  one engine session from LilBot's copy and keeps importers, journal and replay from restoring it (Hermes untouched;
  the main session is refused). It previews without `--yes` and reads `LILBOT_DATA_DIR`.
- Attachment metadata and thread references are merged at the HTTP edge; a thread's private transcript is never
  indexed. Routine and webhook runs and hidden thread and review sessions are excluded, and so is a session the engine
  continued one of them in after compressing: Hermes writes that child without the hidden mark, so
  `bots/hidden-chats.ts` follows `BotEngine.compressionRoot` (read-only, from the profile's session metadata, roots
  remembered) and the overflow catalogue drops a lineage with any hidden or tool session in it. The same check keeps
  those sessions out of activity observation and both memory reviews. When the lineage cannot be read the session
  counts as hidden (it fails closed, logged once a minute as `[session-lineage]`) and is asked about again next time.
- `chat.open`/`chat.new` keep their snapshot shape: `items` holds the latest 100 records without session dividers (for
  old clients); additive `history` holds the page (`shared/history-schema.ts`). The active session id remains
  `snapshot.chatId`; a new session keeps earlier history.
- A session divider (`session:<id>`) marks where a session began. Pages (`HistoryStore.page`) leave out the divider of
  a session with no user or assistant message, unless it is the bot's main session (just after New session). The rule
  is applied when a page is built, so stored dividers (older ones included) and re-imported rows follow it, and nothing
  is deleted: another client's empty session in the same profile, or a session left before anything was said, shows no
  line. A session LilBot started because the engine could not resume the conversation carries `reason: not_resumed`,
  and the screen says so.
- `chat.history` pages are newest first, records within a page chronological. Cursors are bot-bound sort keys, so new
  messages do not shift old pages. `start` appears only on the oldest page after import completes; `null` is not a
  definitive beginning while import is pending. `history.changed {botId}` tells clients to refresh.
- The importer does one 100-row page per bot per second with atomic row/cursor checkpoints; discovery runs every 30
  seconds; startup never waits for history. Errors leave the import pending for retry; it is safe to resume and repeat.
- `search_conversations(query, limit?)` searches only the calling bot's user/assistant rows and reports import
  progress. It moves to #62's hub later.
- Before Hermes compresses, `on_pre_compress` synchronously offers the conversation's user/assistant text (the last
  100,000 characters) to a hidden memory-only review by the same bot, under the normal memory rules. Review sessions
  never review themselves. It is best effort: a failure logs a warning and Hermes may proceed.
- `bun live-checks/history-benchmark.ts` uses a synthetic 5,000-row dev copy, never production data.

## Threads

`server/threads/` owns bot-to-bot exchanges (`shared/thread-schema.ts`): delegation on LilBot's MCP server
(`lilbot_delegate` and the `lilbot_delegation_*` tools, `delegation-service.ts`). The plug-in tools `ask_bot` and
`list_bots` ended with adapter 0.10.0 (#113): new sessions use `lilbot_delegate` and `lilbot_bots_list`. The engine API's
`threads/ask` and `threads/bots` stay only for sessions that loaded 0.9.x. Detail, engine findings and measurements:
[docs/threads.md](docs/threads.md).

- Any bot may hand work to any other, never itself. One `lilbot_delegate` call names several bots, one task each; each
  task is its own exchange and the call's tasks share a `batchId`. `exchangeId` continues the same work. Each exchange
  has a nullable `parentId` (`thread_links`): the delegating bot's work item it was handed out under (see Work).
- The receiver works in its own hidden session with its own instructions, memory, skills, workspace and full access;
  follow-ups reuse it. The delegating bot returns at once; the answer is queued as a hidden input into the exact
  originating session, even if Oscar has since started a new chat. Nested delegation resumes the parent exchange, which
  then reports to its requester. MCP calls carry no session, so `calling-chats.ts` matches the call's `requestId`
  against the `tool.start` events the engine reports (`BotEngine.onToolCall`); a call no hidden run reported is the
  bot's main conversation.
- Status per exchange: `waiting` (accepted, not started), `working` (with the receiver's live activity line, in memory,
  and run time from `startedAt`), `finished`, `failed`, `cancelled` (with `stoppedBy`: the bot or Oscar).
- Control is the delegating bot's only: status, cancel, redirect, wait. Cancel interrupts the receiver's hidden session
  (`BotEngine.stopRun`) and drops its queued work; whatever still arrives is kept in the record as `withheld` and never
  delivered. Redirect is bot text like a request, marked `redirect` in the transcript: steered into the running turn
  (`BotEngine.steerRun`), joined to the first turn when the task has not started, otherwise the receiver's next turn;
  a steer the turn never took runs as its next turn. Wait never holds a call open: each answer still arrives, and the
  bot is told once when all are in (folded into the last answer, or a short LilBot notice).
- Files travel with a request (`files` per task) or an answer (`lilbot_delegation_attach` by the receiver), by path in
  the sender's own folder, with the chat-attachment limits (20 MB, 10 per message): every path part opened with
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
  A running exchange's view has `redirecting` while a redirect
  did not reach the running turn and waits for the receiver's next step.
- A failed exchange carries `failure` (in `threads.list` and `threads.open`), a short fixed phrase chosen from what LilBot
  knows (`thread-failure.ts`): the receiver's turn ended in an error, LilBot could not confirm how it ended (an unknown
  engine receipt), the receiving bot or the bot that handed it over is gone, the request or answer was too long or
  withheld by the safety check, the message limit. Never an exception's text, a run's output or bot text. A stopped
  exchange stays stopped; a follow-up clears the failure. The task line reads "Failed · <failure>" (older failures have
  none and read "Failed · <bot> could not be reached"); its state still comes from `threads.list`. The `thread` chat event
  also carries `failure` while the thread has one (never on the stored tool line, which history records once).
- The leader's row between its own turns in a group reads "Leading a group" (idle), not working and not "waiting" (that
  status means waiting for Oscar); the working marks are chosen in `ThreadRunner.mark`.
- `bots.list` gives a bot working on a task another bot handed it `workingFor` (exchange id and the delegating bot's
  name), from the deliveries running now (`thread-roster.ts`, with the running groups); the roster row reads "For
  <bot> · <activity>". Each of a bot's `groups` entries adds `activity` while its own turn in that group runs and a tool
  call has been seen in it (the runner's live line; a tool call in a group also pushes `bots.changed`): "In a group ·
  <activity>".
- Main conversations get one `tool` reference with `threadId` per exchange (in snapshots and idempotent `thread` chat
  events), merged at the HTTP edge, never written as fake user messages. The screens are in "Work between bots"
  under Web app.
- Hidden session aliases are persisted before submission and excluded from after-chat reviews, also after restart.
  Thread activity sets working/finished without unread (on both bots of an exchange; in a group, on the member taking a
  point and on the leader only for its own turns); only the asking bot's visible answer to Oscar can mark it unread. Status and activity changes push a plain `threads.changed`; the per-bot chat lines are rebuilt only
  when exchanges are added or settle.
- Limits are in `thread-limits.ts`: depth 3, 20 messages per thread with the answer reserved, 20,000 characters per
  request, 6 deliveries running at once (measured on the dev gateway), 8 exchanges under way per delegating bot. A
  limit refuses further work and tells the bot to report back.
- Bot text passes memory-style secret, hidden-character and instruction-override checks and is delivered in a named,
  JSON-quoted fence, never as Oscar's instructions. Delivery and admission ids are persisted and reused across
  transport failures and restarts (the routine runner's receipt machinery); a terminal unknown receipt is never
  resubmitted with a new identity. A stop recorded while LilBot was down is applied when the delivery is picked up.

### Temporary groups

A group (#133) is a thread with more than two participants: its first participant leads, 2 to 4 others are members, and
`group` on the thread holds the purpose, rounds, total turns, end and kept files (`thread_groups` beside it). It runs on
the same outbox, receipts, hidden sessions, file copies and fences as delegation (`group-*.ts`, detail in
[docs/threads.md](docs/threads.md)). One tool, `lilbot_group`, with an action field: `start`, `say`, `attach`, `close`,
`status`.

- Any bot may start one from any session except a group session (no group inside a group; members may still delegate
  to one bot). Retries with the same `requestId` find the same group or round. The first point goes with the start.
- A round: the leader's point (to all, or to named members) becomes one `point` delivery per member, run in parallel in
  each member's own hidden group session (the runner orders deliveries per member within a group). Each prompt carries
  only what that member has not seen (`seen` per bot) plus the point, other bots' words fenced and cut, a message failing
  the shared checks withheld. A member's final response is its reply. When every member a point was for is done, one
  `round` delivery takes the replies to the leader's own hidden group session, in the same transaction; there it says
  the next point or closes. A member's own delegation answered later into its group session joins the discussion.
- Who has replied, member states (`waiting`, `working` with the live activity line, `replied`, `idle`) and the round's
  addressees are worked out from the deliveries and the runner, never stored twice.
- Ending, once, in one transaction (`group-end.ts`): the leader closes with an outcome; Oscar stops it
  (`threads.cancel`, recorded as stopped by Oscar); or it ends by itself at the round limit (once the last round's
  replies are in), the message limit (a point that does not fit is refused; a group with no room for another round
  ends), the time limit, going quiet (nothing queued or running, no point for 15 minutes) or an unreachable leader. The
  outcome, or LilBot's reason with the replies the leader had not seen, is a `notice` into the conversation the group was
  started from, and each member gets a private journal fact (purpose, how it ended, the outcome, its own part; a shorter
  one when memory refuses). Then turns still running stop (on close, not the leader's own), exchanges members handed
  out from the group stop, their unfinished work items drop and the folder is archived; that part retries until done.
  Late words are kept as `withheld`. An ended group is read-only.
- Shared folder: `<workspaces>/.groups/<group id>/`, created through no-follow descriptors. Files from a point or a
  member's `attach` are copied in with delegation's rules and listed with their full path in each prompt. On close the
  leader's `keep` copies files into its own folder (`groups/<group id>/`) and gives them to its Library (the same
  `LibraryService.give` as `lilbot_give_file`), before the folder moves to `<workspaces>/.archive/.groups/<group id>/`.
- Oscar: `threads.list` and `threads.open` include groups (`group` with members' states, rounds with who replied, the
  round limit, turns, end and kept files), `threads.changed` and `threads.cancel`. `bots.list` gives each bot the
  running groups it is in (`groups`: id, purpose, round, round limit, leading), pushed with `bots.changed` when a group
  starts, opens a round or ends. Each participant's main conversation gets a `group` / `in <leader>'s group` line. The
  screens (#136) are in "Work between bots" under Web app.
- Limits (`GROUP_LIMITS` in `thread-limits.ts`): 4 members, 6 rounds, 40 messages, 120 minutes, 15 quiet minutes, 2
  running groups per leader, 6,000 characters per earlier message in a prompt. `LILBOT_GROUP_TEST_ROUNDS` lowers the
  round limit for a dev server with the test data folder and allowlist; production refuses it.

## Work

`server/work/` owns the work board (`shared/work-schema.ts`): every real piece of bot work is an item Oscar can see, with
who asked, who owns it, how "done" is defined, the evidence and the result. What must always happen is built in; what
takes judgement is the `lilbot-work` skill (`server/work/work-skill/SKILL.md`, installed into the skills library at
startup and restored if it differs, like `t3-coding`).

- An item: id, title, owner (name captured at opening), who asked (`oscar`, `bot`, `routine`, `webhook` or `self`),
  origin (`conversation`, `exchange`, `group`, `routine_run`, `webhook_run`), the "done" definition, kind of work, check
  level (0-3) and the kind's default when it got its kind, status (`open`, `working`, `checking`, `needs_oscar`, `done`,
  `failed`, `dropped`), evidence, result, its checks, times, an optional parent and an optional goal (see Goals). Statuses and kinds are checked in
  code, not SQL. `work_events` keeps every change with where it came from.
- Who asked and the origin come from LilBot's records of the calling session (`app-work.ts`, `workSessions`): an
  exchange's hidden session is the exchange, asked by the delegating bot; a routine or webhook run's session is the run,
  asked by the routine or webhook (named by its task); anything else is a conversation, asked by Oscar unless the bot
  says `self`. A session the engine continued after compressing one of those counts as it (`bots/hidden-chats.ts`,
  `sessionRoots`, the lookup the hidden-session check uses); while its lineage cannot be read the work call is refused
  rather than credited to Oscar. A group session is the group (origin `group`), asked by its leader; the leader's own
  group session is its own work (`self`).
- Rules: opening needs a kind; with a definition (or at level 0) it starts the work; `working` needs the definition and a
  kind; `done` needs them, at least one evidence entry and a result, unless the item is at level 0. Only the owner reports
  on its item; the caller is the key's bot. `needs_oscar` carries exactly one question; a second while one waits is
  refused. `failed` needs a result, `dropped` a reason. Final items take nothing more. Nothing is deleted.
- Evidence: what it proves plus exactly one pointer: a Library item of the owner (checked), a url, a command with its
  output, or a number with its source and time. All work text passes `memoryRefusal` (no secrets, hidden characters or
  instructions); output is capped at 4,000 characters.
- `needs_oscar` uses the activity service like a waiting session (`work:<item id>`): the bot shows waiting and turns
  unread unless Oscar is viewing; leaving it ends the waiting state. The live line is in memory; unread survives restarts.
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
  `work.changed`. Screens: `needs-ui`.
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

### Check levels (#142)

0 no check; 1 the owner reads the real result and attaches evidence; 2 a second bot reproduces the claim (a fresh session of
the owner when no other bot is eligible); 3 Oscar checks.
What must happen is built in (`work-check-*.ts`, `work-checks.ts`, `work-levels.ts`); how to check is the `lilbot-check`
skill (`server/work/check-skill/`, installed like `lilbot-work`).

- Kinds (`shared/work-check-schema.ts`) and built-in levels: `reply`, `note` 0; `file`, `computer`, `code` 1; `deploy`,
  `outside` (a message or post that leaves the system), `spending`, `figure` (a number Oscar decides on) 2. Oscar sets a
  default per kind and per kind for one bot (`work.levels.get`, `work.levels.set`, null removes his; `work_levels`, bot
  id '' for every bot); the bot's wins. "Hard to undo" is not a kind: the skill tells bots to raise the level for it.
- The bot gives the kind at opening (an exchange's item: when the receiver first reports); LilBot refuses a level below
  the effective default and any lowering; raising is allowed until it finishes. An item from before kinds has none: it
  cannot move to `working` or `done` until its bot gives one, which can raise its level to that kind's default.
- Level 2: the owner's `done` (same checks as level 1) moves the item to `checking`, not done; LilBot picks the checker
  in the same transaction (`work_checks`): never the owner or the owner of any item under it, never a choice of the
  owner's (there is no argument for it); among the rest, one that has not checked this item, then the fewest checks, then
  by id. Candidates are bots that are ready or being prepared. A real second bot is always preferred.
- No other bot eligible (Oscar has one bot, or every other bot works under the item): the check is a **same-bot check**,
  never a wait for Oscar. It is a new hidden session of the owner (`by` is the owner, `sameBot` true), told nothing but
  the check prompt (done definition, claim and evidence pointers fenced as data), so it remembers nothing of the owner's
  conversation, read-only by instruction. It runs on `LILBOT_REVIEW_MODEL` when that differs from the bot's own model
  (`WorkHost.checkModel`, `differentModel`; a bot with no model of its own counts as different), else on the bot's own,
  and the check's `note` says which. The choice is saved with the check (`same_bot`, `checker_model`, `WorkCheck.sameBot`
  and `model`), so Oscar's screens can show it, and a restart reuses it. A run with another model starts without the
  bot's reasoning effort (like the memory review). Limit: the fresh session still loads the bot's LilBot memory block
  (lasting facts and recent journal entries, a plug-in `prefetch` for every session), which may mention the work; LilBot
  cannot strip it.
- The check runs as a new hidden session of the checker (`work-check-runner.ts`, run id `check-<check id>`, both session
  ids saved before the prompt in `work_check_chats`, so it is excluded from history, activity and both memory reviews).
  The prompt gives the done definition, claim and the owner's evidence in a `work-claim` JSON fence, and the owner's
  folder. Read-only is by instruction only (full access, like routines). Retries and restarts reuse the run id.
- The verdict comes only through `lilbot_work` (`verdict`, `result`, the checker's own evidence) from the assigned bot,
  from that check session (`work_check_chats`): for a same-bot check the owner's main and every other session are refused,
  though it is the same bot. `verified`: done. `not_verified`: back to `working`, the owner told once through
  `work_answers` with what the checker saw (fenced); a second failure waits for Oscar. `could_not_check`, a run that ends
  without a verdict, or a checker that is gone: waits for Oscar. While a check is open the owner can report nothing.
  These notices (and Oscar's send-back) reach a handed-over item's owner in its own session, not through the exchange.
- Oscar's checks: level 3, a second failure or a check that could not be done put the item in `needs_oscar` with an
  open Oscar check. `work.pass` (optional note): done.
  `work.sendBack` (reason): back to `working`, the owner told. `work.answer` refuses these. Dropping an item closes its
  open check.
- A level 2 or 3 item is done only as `verified` (a bot) or `passed` (Oscar): every summary carries its latest `check`,
  and an item carries all of them. Track record and spot checks are not built (proposal on #142).
- The note has two static lines on when to open an item: before any work beyond a reply, however small (changing
  something, handed over, scheduled or from outside), not for answering a question.

## Goals

`server/goals/` owns goals (`shared/goal-schema.ts`, #143). Oscar gives an outcome once, in his words; the bot proposes an
agreement and a target measured from a real source; once he agrees, the bot works on the board and LilBot's review
routine reports against the target on a rhythm. The bot promises the work and measures honestly; it does not promise the
number. How to propose and review is the guide topic `goals` (no skill: a skill's catalogue line costs every turn).

- A goal belongs to one bot: Oscar's words, the agreement (what it does alone, needs from Oscar: access, money, a
  decision; cannot influence), the target (measure, source, the baseline value with the time LilBot saved it and one
  evidence pointer of the reading, the target value, a due date `YYYY-MM-DD` in Adelaide), the review rhythm (a routine
  schedule, default weekly on Monday at 09:00 Adelaide) and a state: `proposed`, `agreed`, `paused`, `reached`, `dropped`
  (the last two final). Events and reviews are never deleted (`goal_events`, `goal_reviews`).
- Bot tool (System MCP): `lilbot_goal` with `action`. `propose` without goalId: a new goal, only from a conversation session
  (never a routine or webhook run, an exchange or a check; the call is traced like `lilbot_work`), with Oscar's words,
  the agreement and the target; with goalId, a new version of a proposed goal or a change to an agreed or paused one
  (`why`; a new agreement, target or rhythm, or `drop`). `progress`: a review. Reads go through `lilbot_work_list`
  (`goals`, `goalId`), so goals add one listing line per turn. Request ids make retries safe; text passes `memoryRefusal`;
  a target differs from its baseline and is due today or later; a rhythm keeps the routines' minimum interval.
- Nothing proactive before Oscar agrees: a work item links to a goal (`goalId` at opening, nullable `work_items.goal_id`)
  only while it is the bot's own and `agreed` (`WorkHost.checkGoal`); reviews likewise; there is no routine before.
- Oscar: `goals.list` (bot, states), `goals.open` (its reviews, work items and events), `goals.agree` (a proposed goal
  starts, a paused one resumes, a proposed change applies and a proposal to drop drops it; `review` replaces the rhythm),
  `goals.adjust` (his words; the bot proposes again), `goals.pause`, `goals.drop` (optional reason), push
  `goals.changed`. A proposed goal or a change waits for Oscar: the bot shows waiting and turns unread (`goal:<id>`), like a
  `needs_oscar` item, and it is not also a work item, so he has one way to answer. Screens: `needs-ui`.
- Each decision is saved with its notice in one transaction. Notices are hidden turns in the bot's main conversation
  through `work_answers` (`WorkAnswers.notify`, stable run ids): agreed (open an item per thing it does alone and a
  `needs_oscar` item with one question per thing it needs from Oscar), resumed, change applied, adjusted, paused, dropped.
- The review routine (`goal-routines.ts`) is made through `RoutineService.create` once the goal is agreed, with
  `createdBy: oscar` (his agreement is the request), so it is not one of the bot's five; request id `goal-<id>-<n>`. A
  tick every five seconds keeps it matching the goal: running while agreed, paused while paused, removed otherwise, on
  the goal's rhythm (a new rhythm replaces it as `n+1`); one the bot paused or deleted with its routine tools comes back.
  Its task names the goal and reads it live, so a changed target needs no new routine.
- A review comes only from a run of the goal's own review routine (the calling session's routine), so reviews keep the
  rhythm; it needs the value read now, `did` (what the bot did of what it said) and evidence. LilBot compares the value with
  the previous review (or the baseline) and the target: moved toward, away or not at all, met, and stalled (not met, and
  nothing moved toward the target in this and the previous review, or past due). A stalled review is refused without a
  change or drop in the same call, unless one already waits. The report becomes a work item through `WorkService.act`,
  linked to the goal: kind `figure` (level 2 by default, so a second bot, or a fresh session of the bot when it is the only one, reproduces the reading; Oscar may change the
  default), the reading as a number entry plus the bot's own evidence, and a result that keeps "Number: ..." and
  "Work: ... (items for the goal: ...)" apart. Review items are not counted as the goal's work.
- Reached only when the latest review met the target and its work item is `done` (checked at its level), never on the
  bot's number alone; the routine is then removed.
- `goals.drop` drops every unfinished item of the goal in the same transaction (`WorkBoard.dropping`, the same as
  `work.drop`, which tells the bot about each); only with none does the bot get the goal's own notice. A deleted bot's
  goals are dropped ("The bot was deleted."); its routines go with it.

## Restart recovery

Restarting LilBot only leaves Hermes turns and T3 tasks running; nothing is resubmitted.

- The browser reconnects and opens the persisted main conversation. Hermes says whether the turn still runs; LilBot
  reconciles the durable transcript, including tool work and the final answer.
- A new main session starts only when Oscar asks for one or the engine truly cannot resume the conversation: a "not
  found" is asked again on a newly attached connection, and only a second refusal starts one, logged as `[chat]
  conversation could not be resumed` with the engine's code and shown on its divider. A deploy-like restart (past the
  gateway's 20-second grace), a tool reconnect and a second device keep the session (`check:restart`).
- Routines and webhook runs recover the same persisted run and admission receipt. Threads recover their outbox and return the answer to
  the original caller session, never a replacement exchange; a steered redirect is checked against the recovered
  transcript, and a stop is applied again. Oscar's answers, drop notices and goal notices still waiting are
  delivered with the same run id; a drop's exchange stop is already saved. A goal's review routine is made, paused or
  removed to match the saved goal on the next goals tick.
- The T3 bridge reloads its sign-in from the data directory. Stable per-bot request ids let an uncertain launch find
  the original T3 task, and its thread id allows later waits and reads. A bridge call in flight during downtime
  fails; the bot retries it after reconnecting.
- This covers a LilBot process restart with data preserved, not a Hermes crash or a machine reboot. An unknown engine
  receipt fails explicitly rather than repeating possibly completed work; engine crashes cannot guarantee exactly-once
  external side effects. Failed deployments are recovered by the deploy watchdog. The self-development skill is not
  installed.

## Deploy

Production runs only from `~/lilbot/release`, a symlink to an immutable built folder `~/lilbot/releases/<commit>`.
`~/code/LilBot` and T3 worktrees are development source only: editing or pulling there does not change production.
Nobody edits release folders. Only `bun run deploy` builds releases and restarts the live service; bots restart
production only through it.

- Procedure: commit, then `bun run verify && bun run deploy` in a clean source checkout. Verify records the exact
  commit; a dirty checkout gets no deploy marker. Deploy builds that commit from `git archive`.
- Rollback: an independent watchdog (`lilbot-deploy.service`) copies the database, switches the release symlink,
  restarts LilBot and checks health for 60 seconds. On failure it stops LilBot, restores the database, switches back
  to the previous release and restarts once (no Git checkout, reset, install or build during rollback), then checks
  that version for another 60 seconds. Failed recovery stops the service and keeps the lock, releases and copies for a
  person; it never loops. A killed watchdog also leaves its lock. Nothing removes a stale lock automatically.
  Development checkouts, including uncommitted changes, are never touched.
- Database copies use SQLite's online backup API; never raw-copy `lilbot.db`, `-wal` and `-shm` independently. The
  data directory is never replaced: keys, `engine-token`, `t3-grant.json`, other secrets, workspaces and engine
  sessions stay in place. Back up `computer-server-key.pem` securely alongside the database copies.
- Outcome: `bun run deploy --status` tells the deploying bot the result on its resumed turn. The last failure is a
  notice the app fetches on reconnect and every bot's next memory context includes. No agent loop, developer bot or
  notification system for it.
- Migrations and new plug-in versions ship with a normal deploy; existing data imports after it.
- Internals, installation, overrides and manual recovery: [docs/deploy.md](docs/deploy.md).

## Library

`server/library/` owns delivered items (`shared/library-schema.ts`). A bot delivers with `lilbot_give_file` (path, title,
`requestId`; LilBot's MCP server, #113), which needs a title and the conversation the call came from. That comes from
LilBot's records of the call (`giveFrom` in `app-work.ts`: the `requestId` matched against the engine's tool starts, as
for `lilbot_delegate` and `lilbot_work`), never from an argument: a routine run's two session aliases and a session the
engine continued after compressing it resolve to the persisted run id of that bot (`workSessions`), a webhook run's
session is recorded as the conversation, and a lineage that cannot be read refuses and gives nothing. Each call is
logged in `system_changes`. The adapter's `give_file` ended with adapter 0.12.0; the engine API's `/engine/library/give`
stays for sessions that loaded an older adapter.

- Items point to workspace files, never copies; only explicitly given files appear. Kinds: media (image/audio/video
  MIME), page (.md/.html/.htm), file. Size limit in `library-files.ts`.
- `library.list` is newest first, filterable by kind, grouped Today / This week (Monday start) / Older in UTC, with a
  missing status. `library.content` returns a download URL; `library.workspace` lists a folder separately.
- Reads use Linux descriptor-relative opens with no-follow flags; workspace-root symlinks and nonregular files are
  refused.
- Hermes exposes no outgoing attachment manifest, so assistant files are not collected automatically; tool image
  previews are not deliveries. No Library UI yet.

## Chat attachments

`server/attachments/` owns incoming files and message associations; the screens are in `web/src/attachments/`.

- Three ways in, several files at once: the composer's plus button, pasting files (pasted text stays text) and
  dropping on the conversation column. Uploads in progress disable Send; a message may be files only. Refused files
  (with a reason) and files over the per-message limit never block sending the rest. The client counts staged,
  not-refused files against the limit before `attachments.prepare`; the server enforces it again on send.
- File names are untrusted: always plain text (React text nodes, `alt`, `title`, `download`), never HTML, and never
  part of a path. Staged files belong to one bot: switching bots empties the composer and ignores late uploads.
- Upload: `attachments.prepare` reserves files in order, then the raw bytes are PUT (not multipart) to each
  `uploadUrl`. Removing an unsent chip does not delete its workspace file. An interrupted upload can be retried; a
  partial file that survived a crash is refused, not overwritten, and the client prepares a new file. No byte-offset
  resume.
- `chat.send` with files needs a client UUID `messageId` (`newMessageId`, which also works on plain-HTTP pages). Every
  attachment must be ready and belong to the open chat's bot. Retries use the same id, text and files (engine
  admission idempotency); a changed payload is refused. The send answer and the `user.message` event are reconciled by
  `messageId` (`withSentMessage` in `chat/chat-state.ts`), never a second bubble, queued sends included.
- The association is saved before submission. A unique display-only marker in the engine's stored text identifies the
  exact row (allowing the engine's prepended image analysis and appended image references); the HTTP edge swaps it for
  the original text and metadata. Reopening reads SQLite and never resubmits; an uncertain send is retried only by
  explicit client action.
- Image support is `supported | unsupported | unknown`, kept as it was at send time. Show "model cannot see images"
  only for `unsupported` with a positive count. Hermes declares no vision capability, so it reports `unknown`, never
  a guess from model names.
- Storage: streamed to generated names in the bot's `attachments/` folder through no-follow, exclusive-create file
  descriptors; the stream enforces the size cap; directory swaps are refused; partial writes are removed; reads
  verify SHA-256 before returning bytes. MIME is normalised; PNG/JPEG/GIF/WebP magic decides image delivery and other
  images are refused with `unsupported_image`.
- Non-image files reach the bot as workspace references; the note treats file names and contents as data, not Oscar's
  instructions.

## Coding (T3 Code)

Coding goes to T3 Code, Oscar's coding backend, through its MCP tools. LilBot builds no coding engine, worktree or
pull-request handling. Running commands, reading files and using apps stay ordinary bot work.

- The T3 connection (`server/connections/t3-connection.ts`) is given to every bot by every engine
  (`BotEngine.prepareConnections`, on creation, startup and before use). With the system server it is an exception to
  "tools and MCP connectors stay with the engine".
- The bridge (`t3-bridge.ts`, `/engine/t3/mcp`) forwards Streamable HTTP MCP to T3 Code (`LILBOT_T3_MCP_URL`). Callers
  present a per-bot key (`HMAC(engine token, "t3-bridge:<bot id>")`); deleted bots are refused. It narrows the tool
  list to `T3_TOOLS` (no project deletion, themes, schedules or machine linking) and prefixes each `clientRequestId`
  with the bot id, because T3 scopes retry keys to the one shared sign-in.
- One shared sign-in with Full access in `<data>/t3-grant.json` (0600). `bun run t3:sign-in` redeems a one-time
  pairing code Oscar creates in T3 Code on the leader's environment (Settings → Sharing & access → Create link → Copy
  code; the link works too; codes last about five minutes). T3 has no refresh grant: the sign-in lasts 30 days, then
  Oscar approves again. The running server picks up a new sign-in without a restart.
- Missing, expired or revoked: the bridge answers MCP itself with one tool, `t3_connection_status`, telling the bot
  what to tell Oscar. A T3 401 on an unexpired grant marks it revoked; the 401 is never passed on, so an engine never
  starts its own OAuth. `connections.status` returns state and expiry, never the token. No Settings screen yet
  (`needs-ui`).
- Bot instructions are the skill `t3-coding` (`server/connections/t3-coding-skill/SKILL.md`), installed into the
  skills library at startup and restored if it differs: one launch with a stable `clientRequestId`, then
  `t3_thread_wait`/`t3_thread_read`, with the T3 `link` in the chat right away and with the result. An uncertain
  launch retries the original `clientRequestId`, never a replacement task. There is no LilBot follow-up queue after
  the Hermes turn ends.
- `check:coding` runs its real task in the project root of a throwaway repo (T3's MCP has no worktree removal) and
  revokes its own sign-in at the end. T3 recovery has a unit test with a simulated upstream; the live grant is never
  copied into tests.

## System: the note and LilBot's own MCP server

Every bot knows it lives in LilBot and can operate the app, not only a special developer bot. Tool list, measurements
and how to add a tool: [docs/system-mcp.md](docs/system-mcp.md).

- The note (`bots/system-note.ts`, about 200 words, the rules for choosing a computer included) is added after the user's instructions whenever an engine applies a
  bot. The stored and shown instructions never include it. It is the engine-neutral system-prompt path: Hermes does not
  show MCP `instructions`, and its per-turn memory block repeats in every turn. Keep volatile facts out of it (any change
  rewrites every bot's instructions); `lilbot_about` gives the live ones.
- The server (`server/system/`, `/engine/lilbot/mcp`) is on the private listener only, never the Access listener or the
  helper door. It is the second LilBot-owned connection, given to every bot through `BotEngine.prepareConnections` with
  the bot's own key. The caller is always the key's bot: arguments cannot name another identity and deleted bots are
  refused. Tools are prefixed `lilbot_`.
- Each tool calls the service function the screen uses, so rules, checks and `bots.changed` pushes are identical, and each
  change is logged with the calling bot. There are no destructive tools: deleting a bot, removing a computer and
  forgetting another bot's private facts are Oscar's to do. The exceptions are a bot deleting its own webhooks and its own routines.
- A release that changes a tool reconnects every bot once; an unchanged restart applies nothing. Tests fail when the tool
  list or a guide (`server/system/guide/*.md`, shipped with each release) drifts.

## Computers

`server/computers/` owns computer records, keys, install codes and durable requests; `shared/computer-schema.ts` is
shared with the standalone `helper/` client. Protocol, limits, build and tests: [docs/computers.md](docs/computers.md).

- The leader is always `leader` and runs operations locally through the same bounded runner. Every bot can use every
  computer; the authenticated bot owns its requests, never an id from the body. All computer operations require
  `full-access`.
- Browser methods `computers.list`, `computers.installCode`, `computers.remove`, `computers.addThis.*` and the
  `computers.changed` push exist. Settings > Computers (`web/src/computers/`, [docs/screens.md](docs/screens.md)) lists
  machines live (leader first, online/offline/key-conflict dots), removes after confirmation and mints a one-time
  command in "Add by command line"; the code lives only in that dialog's state. "Add this computer" is a three-step
  dialog on `computers.addThis.*` (download, open the installer, connected) whose code lives only in its state and shows
  only in the not-detected state. Helpers connect only through the helper door.
- LilBot creates `computer-server-key.pem` (0600) in its data directory; the install code pins its fingerprint. Back
  it up with the database and preserve it on redeploy. Key replacement needs re-registration with a new install code.
  Every frame is signed; helpers need TLS except on loopback. Revocation takes effect only through a signed revoke.
- Computer hard stops (Hermes' `detect_hardline_command`) are a guard for full-access bots, not a security boundary:
  direct engine submissions and write/copy operations do not enforce Hermes' protected-path refusals. Full-access bots
  share the OS user's authority. Machine output is untrusted data.
- Deliver the helper binary and its `.sha256` from a trusted channel; the sidecar detects corruption, not tampering.
- A failure to configure the computers plug-in is logged without making the bot unavailable.

### My computer: devices and the main computer

`server/devices/` knows which device a message came from, so "my computer" can be worked out. Methods, push, limits and
tests: [docs/computers.md](docs/computers.md#my-computer-devices-and-the-main-computer).

- A device is one browser or app install: an id the client keeps, a name the client prefills (for example "MacBook ·
  Chrome"; at most 100 characters, no control or hidden characters) and an optional link to one computer. `devices.current`
  makes the record on first sight and returns it with `resolves` (the linked computer, else the main one, else none,
  with its online state), `devices.rename`, `devices.linkComputer`, push `devices.changed`. `computers.setMain` marks
  one computer (any, the leader included; removing it clears the mark) and `main` is on `computers.list`,
  `lilbot_about`, `lilbot_status` and the computers plug-in's `list_computers`.
- `computers.addThis.start` takes the device id: when a computer registers with that attempt's code, that device is
  tied to it (a callback; `computers/` never imports `devices/`). The link can be changed or cleared by hand.
- The origin is metadata, never Oscar's text. `chat.send` takes the device id; LilBot gives the engine a line outside the
  text (device, its computer's name, id and online state, or "not a connected computer"; routines and bot requests say no
  device sent them). Hermes gets it in `api_text`, so the stored transcript is exactly what Oscar typed. A device id
  LilBot does not know is told to the bot as unrecognised. Never taken from the typed text.
- Each stored user message carries the device id and its name at send time (renaming does not rewrite old messages;
  messages from before have none), in snapshots, `chat.history` pages and the `user.message` event (also sent for plain
  messages). A message with files keeps it in its own record; a plain message waits in `message_origins` until the
  history importer matches it to its row: same bot, same text, oldest first, sent up to six hours before the row. A matched
  row is remembered by id, so importing a page again gives the same answer.
- The bot's rules live in the note and `server/system/guide/computers.md`: a computer named in the message, else the
  origin device's, else the main one; ask Oscar in the reply (not with a tool: LilBot draws no card for one), listing
  computers by name, when it is offline, none can be told or the words fit several; never guess for a command that
  changes something; say which computer was used. The rules are static text: the note's existing line of computer names
  is unchanged and it adds no online state and no main mark. Live facts come from the per-message line, `lilbot_about`
  and `list_computers`.
- A device id from a browser is not a security boundary: the private and Access listeners are already Oscar-only.
- Screens (`web/src/devices/`, [docs/screens.md](docs/screens.md)): the browser keeps its device id in
  `localStorage` (`devices/this-device.ts`, made on first use) and registers it with `devices.current` on every
  connection; every `chat.send` carries it and a client `messageId`, so the `user.message` event fills in the sent
  message, and a message from another device or tab joins the conversation live. Settings > Computers starts with
  "This device" (name, "Runs on", the line from `resolves`); the list has the Main tag and "Make main"; the last step
  of "Add this computer" has the "Make it my main computer" switch. A user message from another device shows
  "from <name>" under it, as plain text.

### Adding a computer from its browser

Oscar opens LilBot on the machine, chooses "Add this computer", downloads the installer, opens it, and the computer
appears. No terminal on macOS. The command-line install (`computers.installCode`) stays for headless machines.
Protocol, browser behaviour, building and signing: [docs/computers.md](docs/computers.md#adding-a-computer-from-its-browser).

- `computers.installCode` also returns `helperUrl`, the helper door origin, when `LILBOT_HELPER_URL` is set; the
  command-line dialog builds its command from it (no hostname in the web code) and says so when it is missing.
- `computers.addThis.start({ name, system, deviceId? })` mints an ordinary install code (single use, 10 minutes) for an attempt
  and returns the downloads for that system, or `supported: false` (`system`: not macOS or Linux; `unavailable`: no
  installer built for this LilBot). `computers.addThis.status({ attemptId })` answers waiting, registered, connected or
  expired, with the computer once one registered with that attempt's code (migration 23 links them).
- Downloads are served from `<data>/helper-downloads` at `/api/computers/download/<file>` on the private app and the
  Access listener with the socket's Host/Origin checks and no cross-site fetches; never on the helper door. A build is
  offered only while its sidecar's settings hash matches the server's current settings.
- An installer is the same file for every machine and carries no secret. It does carry this LilBot's public
  settings, baked in at build time and written by the server to `helper-settings.json`: the helper door origin
  (`LILBOT_HELPER_URL`, required for the feature), the exact page origins allowed to hand over (the non-loopback
  `LILBOT_ALLOWED_HOSTS` names and the Access name over HTTPS; loopback pages only in development) and the server key
  fingerprint. The helper never registers anywhere else, so a page or local process cannot point it at another server.
  Changing those settings means rebuilding the downloads.
- Hand-over of the code, first that works: (1) the opened helper listens on `127.0.0.1:47613` for 10 minutes and
  accepts one code, only from an allowed Origin with the loopback Host, only from a socket owned by the same OS user;
  (2) a `lilbot-helper://register#<code>` link handled by the macOS app; (3) the same short line pasted into the
  installer's window. The page holds the short code (no fingerprint); it never goes into a logged URL, argv or a log.
  A port already taken by something else disables (1). Registration itself is unchanged: HMAC and the helper's fresh
  key proof through the helper door.
- Opening a downloaded helper again on a registered machine replaces the installed binary and restarts the service:
  the update path. Only opening the app updates: a `lilbot-helper://` link on a registered machine does nothing, since any
  page or local program can open one. Baked builds register only at their own door.
- The macOS app is built, signed with a Developer ID Application identity, notarised and stapled on a Mac by
  `scripts/sign-macos-helper.ts`. Identity and notary key (path, key id, issuer id) come from that Mac's environment
  or a local file outside the repo; never put them, the team id or an email in the repo, issues or PRs. An unsigned
  (ad-hoc) app still works after Privacy & Security > Open Anyway.

## Skills

`server/skills/` owns a shared standard SKILL.md library at `~/lilbot/skills` (`LILBOT_SKILLS_DIR`), with authorship
and per-bot off switches in SQLite. All skills default on; Setup shows the same states.

- Chat, routine runs and memory reviews prepare the same catalogue and switches. Switches control offered skills, not
  filesystem access for full-access bots. Tool changes apply at once; prompt catalogues refresh next session.
- New and edited skill text refuses secrets and hidden characters; instructions in a skill are allowed. Authorship
  comes from the bot's capability.
- The three skill tools stay on the Hermes skills plug-in, not on the MCP server (#113, third slice): Hermes' own
  `skill_manage` cannot be dropped without a patch, and without the override it would write into the library with no
  check and no author. Evidence and the way back: [docs/hermes-engine.md](docs/hermes-engine.md#skills-plug-in-skills-adapter).
- Import copies user skill folders from bound, non-deleted profiles once per source path, never moving or deleting
  profile files. Identical copies coalesce; different contents get a stable hash-suffixed name. Imported text is not
  retroactively filtered. Native engine skills stay with the engine; changing one through the app tool first creates
  an app-owned copy.
- Removing duplicate profile skill folders is a future, separate change made after checking import results and
  backups.
- One "Include this engine's skills" switch per engine (#140), global for all bots (`engine_skills`); per-bot
  differences stay with the per-skill switch. It covers the skills imported from that engine's profiles (origin kept in
  `skill_origins`, set when an import writes the skill, so a bot's later edit does not move it) and the skills the
  engine offers by itself. Off: excluded, so no bot is offered them; nothing is deleted and no per-bot switch is touched,
  so switching on restores them exactly. Hermes hides its bundled skills through the profile's `skills.disabled`,
  except `hermes-agent`, which Hermes refuses to disable: `BotEngine.alwaysOnSkills` reports it with the reason.
- Defaults: an engine that already has bots when the migration runs is on (Oscar's Hermes, so nothing changes); an
  engine added later, or a new LilBot, is off, and start-up imports nothing from it until it is switched on. Turning a
  switch applies it to every bound, non-deleted bot in the background (the start-up flight, with its retries).
- `skills.list` gives each skill's `origin` (LilBot, an engine, a bot, Oscar) and `excluded`; `enabled` stays the bot's
  own switch. `skills.engines` lists engines with their state, counts and always-on skills; `skills.setEngine` sets it,
  with the `skills.changed` push. Oscar's setting: no bot tool. Screen: `needs-ui`.

## Memory

LilBot owns memory so it survives an engine change, can be shared between bots, and can be seen and corrected by
Oscar.

- `server/memory/memory-store.ts`: the `memory_facts` table with full-text search. A fact has a kind (`profile` =
  lasting, `journal` = dated history), a scope (`bot` = only the bot that learned it, `shared` = all bots), an author
  (bot or user), dates, an optional expiry, `via` (chat, review, app, import) and the chat it came from. Forget marks
  a fact; it is never erased. A fact can be paused (kept, not shown to bots), forgotten and restored.
- `memory-service.ts`: the rules, engine-neutral and unit-tested: default scope (profile facts shared, journal entries
  private; either can be overridden), visibility, de-duplication, recall by search, and `contextBlock`, what a bot sees
  before each turn (lasting facts, then its last 10 journal entries, within about 1,500 tokens; the rest by recall).
  A write tells the bot when it holds more lasting facts than it is shown, so it tidies.
- The engine reads and writes memory through a plug-in (Hermes: Python, standard library only, holding no data) and
  the engine API: `recall_memory` and `update_memory` (write
  or forget one fact, optional `expires`). New bots use LilBot memory from their first session; an existing bot is
  connected from its Memory panel, from its next session.
- Saving rules (in the plug-in's instructions): save only what is grounded in the conversation, never infer traits, a
  one-off request is not a standing preference, one fact goes in once, and never save secrets, what can be looked up,
  task progress or "tool X is broken". `memory-safety.ts` refuses facts carrying model instructions, secrets or
  invisible characters (zero-width, bidi controls, the byte-order mark, stray tag characters), from bots and from the
  user. Soft hyphens, the England, Scotland and Wales flags (the only tag sequences allowed; other tag characters are
  hidden ASCII) and other format characters stay ordinary text there and in bot-to-bot messages; only webhook payloads
  refuse every format character but the soft hyphen. Every rule scans in linear time.
- Plug-in versions: the current one is in `memory-adapter/plugin.yaml`. To ship a change, bump `version` there and
  `VERSION` in `__init__.py`: each version installs into its own folder and loads on the bot's next session; start-up
  reinstalls older adapters only for bound, non-deleted profiles. LilBot warns when a bot still calls with an older
  adapter.
- Design sources: `~/agent-tmp/memory-study/` (Hermes, OpenMausBot, nightly-labs OpenBot, CopilotKit OpenBot).
- Not built yet: the nightly tidy-up (merge duplicates, drop outdated facts), attaching facts relevant to the user's
  message automatically, and holding a turn's writes until the turn succeeds.

### The after-chat review

A bot saves what it notices during a chat; LilBot's review catches what it missed (Hermes' own review does not run
for connected bots).

- Finished turns of real conversations (not routine or webhook runs, bot threads, their compression children or
  sub-agents) queue in `review-queue.ts` until reviewed; the save before compressing skips the same sessions
  (`saved: false`, which the adapter logs as a warning).
- `memory-reviewer.ts` reviews a bot once 10 turns wait, or once 3 wait and the chat has been quiet for 2 minutes.
  `LILBOT_REVIEW=off`, `LILBOT_REVIEW_TURNS` and `LILBOT_REVIEW_QUIET_SECONDS` change that. Each tick drops queued
  turns of unknown or deleted bots (also below the threshold or with reviews off); owned bots with missing runtimes
  keep theirs. If the engine reports a missing bot its turns are discarded once; other failures retry after 10
  minutes.
- LilBot runs no model: `BotEngine.reviewMemory` runs a hidden session of the same bot with only its memory tools
  (about 4,500 prompt tokens instead of 26,000), on `LILBOT_REVIEW_MODEL` (`provider::model`; otherwise the bot's own
  model, which costs more). Its own session is never queued for review. The same setting picks the model of a same-bot work
  check (see Check levels).
- A review may not bring back a fact the user removed and may not forget a fact the user wrote. What it saves is
  marked `via: review`. No approval step (Oscar's decision): facts apply at once, and the Memory panel shows where
  each came from and lets him pause, forget and restore.
- `check:memory` reads the bot's real system prompt for the rules; asking a bot to describe its own instructions is
  unreliable.

## Routines

`server/routines/` owns routines, schedules and run history, keyed by LilBot bot id. LilBot dispatches through
`BotEngine.runRoutine` and never creates, changes or removes Hermes cron jobs; existing external jobs stay
independent.

- A schedule is an interval in seconds, daily at HH:MM, or weekly on a local weekday at HH:MM. Calendar schedules
  default to `Australia/Adelaide` and store an IANA zone. DST gaps skip that day's missing time; repeated times run at
  their first occurrence only.
- Bot tools (LilBot's MCP server, the caller's own routines only): `lilbot_routine` (`action`: create, pause, resume,
  delete) and `lilbot_routines_list` (the latest five runs of each routine, results cut to 500 characters). Two tools,
  not five: two listing lines a turn instead of five (#113). The plug-in's `create_routine`, `list_routines`,
  `pause_routine`, `resume_routine` and `delete_routine` ended with adapter 0.11.0; the engine API's `routines/*` stay
  only for sessions that loaded an older one. `createdBy:
  oscar` means the bot acts on an explicit request, `bot` its own initiative (attribution trusts the bot, not a
  security boundary). A bot may self-create at most five, paused included; a goal's review routine is LilBot's (see
  Goals) and not one of them. The minimum interval is five minutes for all. Repeating a create request id returns the original; deletion leaves a tombstone against resurrection.
- The scheduler atomically creates a run and advances the next time before engine calls. After downtime it runs once
  for the oldest missed time and skips the rest. A routine never overlaps itself. Pause stops new occurrences (an
  admitted run may finish); resume starts at the next future time without replaying.
- Each run has its own hidden full-access session in the bot's folder and never touches the main conversation;
  results stay in Routines. Both session aliases are persisted before submission and excluded from the after-chat
  review, also after restart. Persisted run ids supply the session and submission request ids, so retries recover the
  same admission; transport failures retry after 30 seconds. If the engine says an outcome is unknown, show a failed
  run rather than risk repeating side effects. Runs emit activity and can mark the bot unread.
- Browser methods: `routines.list` (newest 50 runs; all stay in the database), `pause`, `resume`, `delete`,
  `openRun` (a tracked chat snapshot, main chat preserved), push `routines.changed`. Screens: "Routines" under Web app.
- A short-interval test override needs all of `LILBOT_DATA_DIR`, `LILBOT_BOT_IDS` and
  `LILBOT_ROUTINE_TEST_INTERVAL_SECONDS`; never on the live server.

## Webhooks

`server/webhooks/` owns webhooks, accepted deliveries and their runs (`shared/webhook-schema.ts`, #12). A webhook
belongs to one bot: a description of what to do when events arrive, the calling service's name (`source`), an optional
signature scheme, and an address. Any sender may call one (Oscar, 2026-11-20).

- The route: `POST /hook/<address>` on the helper door only (`http/webhook-route.ts`), never the private app or the
  Access listener. The tunnel's ingress rule for it is in [docs/cloudflare.md](docs/cloudflare.md); applying it is
  the orchestrator's, after a security review.
- The address is the secret: 64 base64url characters, the webhook id and an HMAC of it and a random per-webhook nonce
  under the engine token (`webhook-address.ts`). It is never stored or logged; it is computed when shown and checked
  with `timingSafeEqual` (one MAC is computed even for an unknown id). A new address draws a new nonce, so even the
  engine token does not give the next one; deletion ends it. The bot gets it from `lilbot_webhook_create` (repeating
  the same `requestId` returns the current address, and a signing secret LilBot made, again: that is how a lost reply
  is recovered) and `lilbot_webhook_new_address`; those tool results stay in its transcript, so the history copy
  holds them too. The list never has it; the screen copies it with `webhooks.address`.
- Signatures (`webhook-signature.ts`, over the raw body): `github` (`X-Hub-Signature-256`; LilBot makes the secret
  when none is given), `stripe` (`Stripe-Signature`, the secret Stripe gives, five minutes of timestamp tolerance) or
  `hmac-sha256` in a named header (hex or base64, optional `sha256=`). With a scheme set, unsigned or wrongly signed
  deliveries get 401 and leave nothing; refusals are logged by webhook id, at most one line a minute per webhook.
- Order at the door: path shape, per-client-address budget (120 a minute, `cf-connecting-ip`; a full table lets new
  addresses through), address check, paused (409, at once), body cap (256 KiB, by Content-Length or as it streams,
  413), signature, per-webhook budget (60 a minute, spent only after verification), repeat (202 "Already received"),
  waiting cap (100, 429), and only then decoding and the safety check, then 202. Deliveries arriving together are
  prepared one at a time, each in its own turn of the event loop (the webhook looked up again first: paused 409, gone
  404), so a burst never holds the server for its sum. Unknown, malformed or deleted
  addresses, other methods and a deleted bot's webhooks get the same 404 as any other path. Limits: `webhook-limits.ts`.
- Repeats (`webhook-delivery.ts`), remembered for seven days: by the sender's delivery id (`X-GitHub-Delivery`,
  `webhook-id`, `X-Delivery-Id`, `X-Event-Id`, `Idempotency-Key`; for Stripe only the event id in its signed body) and,
  for every signed scheme, by the SHA-256 of the signed body, since id headers are not signed and a body may have no
  id. Unsigned webhooks dedupe by header only (identical alerts from them are legitimate).
- What the bot is shown (`webhook-payload.ts`, `webhook-decode.ts`): each event becomes one JSON string at receive
  time: JSON decoded and a one-field form body's field decoded (only text that opens with `[` or `{` is parsed), both refused
  past 64 levels of nesting (counted in one pass before parsing: writing a deeper value back blocks the server for
  over a second); at most 8 headers such as
  `x-github-event`, 200 characters each; every webhook address blanked (escaped, percent-encoded once or twice,
  HTML-entity and fullwidth slashes, whitespace after `/hook/`, the first 64 of a longer run, and any 16-character
  piece of the webhook's own address, with any JSON escape the piece starts inside, so a split one cannot be rebuilt
  and the string stays valid JSON; shorter pieces spread over fields, and other
  forms, are not blanked); cut to 24,000 characters inside the fence, headers included. Two scans must pass
  (`outsideReason`, the shared rules plus every format character but the soft hyphen, the three flags allowed): one
  over every decoded string and key as a model reads them (`folded`: whitespace collapsed; every mark removed before one
  NFKD pass, since reordering a long run of marks is quadratic and once blocked the server for 28 s; compatibility forms
  folded; default-ignorable characters and marks removed; scanned twice, with other control characters as spaces and
  removed when there are any), and one over the stored string itself. The run's `<webhook-events>` fence joins the stored strings
  unchanged (`fenceJson`: `<`, `>`, control and format characters and every default-ignorable character become `\u`
  escapes). Withheld events keep
  no payload; a run of only withheld events records a failed run and never wakes the bot. Preparing any body up to the
  cap takes tens of milliseconds (`tests/webhooks/webhook-limits.test.ts` times it), and a minute's budget of the
  costliest shapes sent at once never holds the event loop for long (`webhook-burst.test.ts`). The rules are a heuristic:
  paraphrase passes, which is why what a run may do matters.
- Runs: a burst ends after 5 seconds without a new event or once its first event waited a minute. A run takes the
  oldest waiting events up to 48,000 characters (about 12,000 to 16,000 tokens; a typical GitHub `pull_request` event
  is 21,700) and 20 events; the rest wait. A webhook never overlaps itself, runs at most once a minute and 20 times an
  hour, and at most two webhook runs go at once across bots. Runs reuse the routines' machinery: persisted before
  dispatch, `RoutineScheduler`, `BotEngine.runRoutine` (hidden session, run id `webhook-<id>`, receipts, retry after 30
  seconds), activity and unread, sessions in `webhook_chats`.
- What a run may do is chosen in one place, `webhook-access.ts`: today every toolset with full access, like a routine
  run. Narrowing it is Oscar's decision (#12 security review, finding 3): set `toolsets` there (the engine starts the
  run's session with only those) and the prompt's sentence beside it. Its single caller is deliberate. A narrowed list
  leaves out `memory`: with it Hermes offers the memory tools, and a run could write shared facts past both reviews.
- Kept: the stored event string only until its run settles, but the run's own engine transcript (opened by
  `webhooks.openRun`) and its result keep what the bot saw and said.
- Bot tools (LilBot's MCP server, the caller's own webhooks only): `lilbot_webhook_create` (request-id idempotency;
  at most five webhooks a bot, whoever asked, since `createdBy` is the bot's word), `lilbot_webhooks_list` (each run's
  result fenced as outside data: a model wrote it after reading the events),
  `lilbot_webhook_pause`, `lilbot_webhook_resume`, `lilbot_webhook_delete`, `lilbot_webhook_new_address`. Nothing is in
  the Hermes plug-ins.
- Browser methods: `webhooks.list` (newest 50 runs with their event counts), `pause`, `resume`, `delete`, `openRun`
  (a tracked chat snapshot), `address` (Copy), push `webhooks.changed`. Screens: #138.
- Without `LILBOT_PUBLIC_ENABLED=1` and `LILBOT_HELPER_URL`, creating a webhook is refused (no outside service could
  reach it).

## Known gaps

- Hermes opens a waiting request (clarify, approval, sudo) only for a client that sends `client.capabilities
  {server_requests: true}`; LilBot sends none, so `open_requests` stays empty, the tool call runs on without Oscar (a
  clarify call waited about 90 seconds) and a question reaches him as a finished reply. The `waiting` status and its
  unread rule are ready, but nothing produces them today. If a client ever advertises the capability, the Hermes
  observer must also emit on a status change: a blocked request adds no replay events, so `key !== saved` stays false.
  Hermes' `error` event (a failure outside a turn) is not mapped: a failed turn always ends with `message.complete`
  status `error`.
- Activity observation polls every second; very short activity may only be seen at completion. Hermes live listings
  show at most 200 sessions per profile. A host-scoped subscription could reduce latency.
- A first history import can only recover rows Hermes still exposes (it may rotate very old compression lineages and
  caps a row at 2 MiB). Rows already copied stay in LilBot.

## Working rules

- Each slice ends with `bun run verify`, `bun run check:live` and the area's isolated checks, then driving the page in
  a browser.
- Logic that can be tested without a browser or Hermes gets a test in `tests/` in the same change.
- Rules and decisions live in this file; area detail in `docs/<area>.md`. Replace outdated text; do not append
  history.

### Before you open a PR

- No dead code: unused files, exports, parameters, branches or settings.
- No duplicates: reuse the existing helper instead of writing it again.
- No pass-through layers, and no option with one caller.
- No comments that restate the code or tell history.
- No tests that assert nothing real or repeat another test.
- Files stay under 200 lines. `scripts/size-exceptions.json` lists the older offenders; it may only shrink.
- `bun run verify` passes, including knip and the size limit.
- The PR body states the lines and web-bundle delta from the verify growth report.

## Issues and labels

Work is tracked as GitHub issues on this repo, split across threads: a discussion thread files backend issues, an
orchestrator builds them, and a separate UI thread designs screens. The discussion thread does not talk about layout,
so the labels say whether a screen still has to be designed.

- One issue per agreed decision.
- `backend`: server, data and engine work. The issue describes the data and the API, never the layout.
- `ui`: screens, designed by the UI thread.
- `spike`: investigate and report in the issue; nothing ships.
- `needs-ui`: a note that this feature has a screen nobody has designed yet.
- The discussion thread messages the UI thread directly when it marks an issue `needs-ui`. The message gives the issue
  number, what the screen must show and do, and where the data is documented, never the layout. It also messages the
  orchestrator each time it files or materially changes a backend issue. The labels stay the record and the
  fallback.

Issues are actioned automatically (Oscar, 2026-11-20); nobody has to say "go".

- The orchestrator starts the next open issue whenever a slot is free. It runs at most three builders at once, because
  they share the development gateway; a spike that needs no dev server may run as a fourth. An hourly scheduled task
  wakes it to check.
- Order: the discussion thread's explicit queue, then bugs and regressions Oscar reported, then the open milestone,
  then the rest, oldest first. "Depends on" notes are respected. Before delegating, and again before merging, re-read
  the issue's latest comments: a later "on hold" or rewrite overrides an earlier confirmation.
- A `ui` issue is buildable once its Paper design is approved.
- Parts marked "proposed, not confirmed by Oscar":
  - an implementation detail goes ahead, and the report says what was chosen;
  - a part that changes what Oscar experiences, costs money, deletes or exposes something, or touches his accounts is
    asked through the discussion thread first, while the rest is built.
- Never automatic, always Oscar's call: paid plans or credits, destructive actions on his data, opening anything new to
  the internet, using his Apple or Cloudflare accounts beyond what he approved, and approving a design.
- Skipped, with a note in the issue: draft PR #4 (the ACP spike, never merged) and anything marked as waiting on
  Oscar.
- Every merge is reported to the discussion thread.

How screens get designed:

- The UI thread designs the screen on Paper and shows Oscar. Only after he approves does it open the `ui` build issue,
  linked to the backend issue, and remove `needs-ui`. No other thread approves a design.
- `needs-ui` never blocks building or closing a backend issue. Whoever builds or closes one leaves the label on.
- A backend issue does not stay open only because its screen is missing. Once its backend part is merged, it is
  closed when the approved design's `ui` issue exists and is linked.
- So `needs-ui`, open or closed, means "no approved design yet". `gh issue list --label needs-ui --state all` lists
  them.

Cleaning up after a merge:

- The agent that merges a PR also removes what it used: its t3 worktree, its local branch and its remote branch.
  With squash merges git reports the branch as unmerged; delete it once the PR shows as merged.
- Remove only your own worktree and branch. Another thread's unmerged work stays.
- A branch whose PR was abandoned is removed the same way, after saying so in the issue.

## Commands

Every `check:*` and `bun live-checks/*.ts` follows the development rules above: dev launcher, temporary `dev-`
profiles, isolated directories, cleanup in `finally`. Most cost a few model calls.

- `bun run verify`: lint, typecheck, knip, file-size limit, unit and contract tests, web build into `dist/`, then a growth
  report (lines per folder, web first-load size). `bun run format` applies
  formatting.
- `bun run dev:setup`: create or repair the development home and start the dev gateway.
- `bun run dev`: Vite with hot reload, proxying to a dev server on `LILBOT_PORT` (default 3371); production ports are
  refused. `bun run start`: run the server (`LILBOT_PORT`, `LILBOT_HOST`).
- `bun run deploy` (`--status`, `--bootstrap`): see Deploy. `bun run t3:sign-in`: redeem a T3 pairing code from stdin
  or `--code-file`, into `LILBOT_DATA_DIR`. `bun run build:helper`: build the computer helper.
- `bun run check:live`: a temporary bot with a throwaway memory endpoint chats, stops, resumes and is deleted.
- `bun run check:reasoning`: on an isolated server, the effort is readable before a message, a model and effort edit applies
  from the next message (between turns and mid-turn, with the earlier context kept), and a routine run and a bot thread
  start with the bot's effort. `bun run check:model-switch`: a switch to a smaller window compacts first and the
  save-before-compress hook runs; a switch of a 100,000+ token conversation is refused with `confirm_required`.
- `bun run check:memory`: tells a temporary bot facts and checks a new session knows them; prints tokens per turn.
  Inherited memory is disconnected before the baseline turn.
- `bun run check:history`: continuous history, paging and search, tool lines after reload and new session, backfill of
  tool rows into a copy that lost them; kills only its own server mid-import, repeats the import without duplicates; forced compression.
- `bun run check:threads`: a temporary bot hands work to another with `lilbot_delegate` and the answer returns; a receiver hands
  it on to a third from its hidden session; the engine API's legacy `threads/ask` still answers idempotently, with its limits.
- `bun run check:delegation`: a temporary lead hands two tasks to two helpers in one call, one with a file; then it
  reads their status, redirects one mid-command and stops the other; the first answer returns once, with a file.
- `bun run check:groups`: on a dev server with the round limit at 3, a temporary lead starts a group with two members and a
  file; both reply at once; LilBot is killed mid-round 2 and restarted (the member's gated script ran once); the member
  attaches a file, the lead closes and keeps it (Library, archive, journal facts) and the outcome reaches its
  conversation; a second group is stopped by Oscar; a third ends by itself at the round limit. Nothing is delivered twice.
- `bun run check:work`: a temporary bot asked for a small real task opens an item, defines done, adds evidence and
  finishes it (seen in `work.list`); done without evidence is refused, by the bot's attempt and a direct call with its
  key; a task it hands to a second bot inside an item becomes that bot's child item, which the helper finishes.
- `bun run check:work-drop`: two temporary bots, with the dev server SIGKILLed right after a drop and after an answer. Oscar
  drops an item mid-work: its turn ends, the bot is told once and says so. Dropping a parent drops the child and stops its
  exchange as Oscar. Oscar answers the child's question: the helper continues in the exchange and the lead gets the outcome
  once in its own conversation; the lead reads the question and answer with `lilbot_work_list`.
- `bun run check:checks`: with one temporary bot (review model Haiku), an item below its kind's default is refused; a true
  level 2 claim is verified by a fresh hidden session of the same bot (recorded as a same-bot check on the review model,
  which Hermes confirms the session ran on, outside the history), and a false one comes back not verified with what the
  checker saw, returns to the owner, then waits for Oscar. The owner's own session cannot give the verdict, skip or answer
  the check. With a second bot, that bot checks instead.
- `bun run check:goals`: a temporary bot told in chat to grow notes.txt in its folder to 10 lines proposes a goal with a
  baseline read from the file; nothing exists for it before `goals.agree`; after it, the review routine (90 s through the
  routine test override, not one of the bot's five) and goal work items appear; the first review is a `figure` item from
  the routine run with the reading as evidence, checked against the file by a fresh session of the same bot; a met goal is
  reached once that check is done.
- `bun run check:routines`: create from chat, a real file-writing run, open history, pause, restart, resume, delete.
- `bun run check:webhooks`: a dev server with its own helper door on loopback and a temporary bot whose webhook is made
  through its MCP tool: a signed event wakes it and the result is recorded and opens; a repeat, an unsigned and a
  wrongly signed event do nothing; a burst of three is one run; pause refuses, resume accepts, delete ends the address.
- `bun run check:restart`: SIGKILLs only its own second server mid-turn; chat, routine and thread side-effect counters
  must stay at one. Confirms its profiles are gone with `hermes profile list`. Then `restart-session-check.ts`: two
  deploy-like restarts (SIGTERM, 30 seconds away), one with a changed tool list, an empty session another client opens
  in the bot's profile and a second device; the same engine session continues, the bot still knows what it was told
  and no divider appears.
- `bun run check:attachments`: a generated PNG, a text file, oversize refusal, the live metadata event, reload and
  byte-identical image reopening.
- `bun run check:skills`: skill use, per-bot exclusion and authored writes, then the Hermes engine switch off and on against
  the bot's real system prompt (Hermes builds it on a session's first turn, so each read runs one trivial turn).
- `bun run check:computers`, `bun run check:access`: see [docs/computers.md](docs/computers.md) and Listeners.
- `bun run check:add-computer`: on a dev server, builds the Linux downloads, downloads one, opens the helper under a
  throwaway HOME with a stub service manager, refuses a wrong origin, hands the code over on loopback and sees the
  computer online. `bun run build:helper-downloads [data dir]`: build the Linux downloads for a server.
- `bun run check:deploy`: temporary clone, release root, data and systemd units; see [docs/deploy.md](docs/deploy.md).
- `bun run check:system`: on the dev server, a temporary bot whose instructions never mention LilBot answers what it runs
  in, which version and how it would change LilBot, then pins another bot and creates one through its `lilbot_*` tools;
  checks the roster push, the change log and that an unchanged restart applies nothing.
- `bun run check:my-computer`: on the dev server, two test computers (real helpers under throwaway homes) and a temporary bot:
  a message from a device linked to one runs on it, from a device with no computer on the main one, with no main computer
  the bot asks and lists both, and with the linked computer offline it runs nothing elsewhere; what ran where is read from
  the server's request table, and `chat.history` rows carry their device.
- `bun run check:coding -- --code-file <file>` (or the code on stdin): needs a fresh pairing code; signs in, checks the
  signed-out, expired and refused messages, a repeated launch and a real task, then archives its threads, removes its
  project and profile and revokes its sign-in.
- `bun live-checks/permissions-check.ts`: repairs a temporary profile from manual approvals to off, runs a harmless
  recursive delete and file write, and checks no approvals remain. `bun live-checks/library-check.ts`: a temporary bot told only to
  deliver a file gives it through `lilbot_give_file` (a `system_changes` row names the item), then push, list, separate
  workspace and download; then a routine run it created gives a file from its hidden session and the item records that run.
