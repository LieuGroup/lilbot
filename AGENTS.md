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
shared/            What the server and the clients agree on: protocol definitions at the root, plus client-only logic in client/ (web and iOS only; never imported by server/ or helper/).
  protocol.ts        every request a client can make      <feature>-schema.ts   each feature's data
  avatar.ts          avatar shapes and colours           avatar-colors.ts   their colour values
  client/            Client logic both apps use: the socket, bot roster/model helpers, and chat transcript rules

server/            The LilBot server (runs on the leader).
  main.ts            Start-up: reads settings, picks the engine, starts listening.
  app-services.ts    builds and connects the services below
  environment.ts     production/development guards        background.ts   guarded timer callbacks
  http/              How the outside reaches the server: browser session, socket guard, engine API, listeners.
  bots/              The bot: service, identity store, user preferences, workspaces, runtimes, deletion.
  activity/          live status and unread
  memory/            The memory system: rules, facts table, safety, after-chat review.
  history/           Conversation records, import checkpoints, paging and bot-scoped search.
  threads/           Bot-to-bot exchanges: delegation, temporary groups, coding skill (`lilbot-coding`), files, control, transcripts and durable deliveries.
  routines/          App-owned schedules, run history and scheduler.
  webhooks/          Outside events: secret addresses, sender signatures, accepted deliveries and their runs.
  work/              The work board: items with "done" definitions, evidence and results, Oscar's answers, its skill.
  goals/             Oscar's outcomes: the bot's agreement, a measured target, the review routine and its reviews.
  library/           Delivered workspace files, metadata, safe reads and folder listings.
  attachments/       Incoming chat files, streaming uploads and durable message associations.
  skills/            The shared skills library, per-bot switches and each engine's "Include this engine's skills" switch.
  prompts/           LilBot's versioned base prompt, engine-neutral prompt assembler and private per-bot prompt store (`LILBOT_PROMPT_OWNERSHIP=1`, off by default).
  connections/       LilBot-owned connections: MCP services bots add (sign-in, tokens, forwarding route, applying changes),
                     legacy T3 Code bridge/sign-in/skill (off by default behind `LILBOT_T3_ENABLED=1`) and shared MCP helpers.
  system/            LilBot's own MCP server through which bots operate the app, and the note every bot gets about its system.
  computers/         Computer identities, key registration and durable command requests.
  devices/           Devices (one per browser or app install), what "my computer" means from each, and where each message came from.
  notifications/     Per-device push registrations, per-device/per-bot settings, deduplication, quiet grouping and pluggable senders.
  database/          LilBot's own SQLite file and its schema steps.
  deploy/            Verified restart, database copies, rollback watchdog and notices.
  engines/           Whatever actually runs the bots.
    bot-engine.ts        the contract every engine must fulfil
    hermes/              the Hermes engine and its plug-ins: the only place that knows Hermes exists

web/src/           The web app.
  app/               start-up, the routes, the connection to the server, styles
  bots/              roster, bot menu and its dialogs, create bot, details panel and its Setup tab
  chat/              the conversation
  history/           the conversation's earlier parts, per-turn usage, context size meter and compaction line
  attachments/       files in the composer and in sent messages, the drop area
  activity/          its details tab
  memory/            the Settings > Memory page (shared facts, one-bot lists, removed, add a fact)
  library/           the Library tab, the bot's workspace folder view and the item viewer
  threads/           work between bots and workers: composer tasks dock, quiet conversation record, opened exchange/worker/group,
                     stop and answer dialogs, Activity "Workers" and "With other bots", roster "Working together"
  work/              the Work board (Today, All work, Checks), item page, check badges and chat Work lines
  goals/             the Goals tab, goal page, review report and chat Goal agreement cards
  routines/          the Activity tab's Routines card, one routine (in place of the panel), a run's transcript; the run
                     list, transcript and delete dialog webhooks reuse
  webhooks/          the Activity tab's Webhooks section, one webhook (in place of the panel), a webhook run's transcript
  skills/            the Setup tab's Skills section: the list with each bot's switch, search, and one skill's reader
  computers/         the Settings > Computers page (list, remove, add this computer, add by command line)
  devices/           this browser's device id and name, and the "This device" block on the Computers page
  deploy/            last deployment failure notice
  settings/          the Settings dialog
  ui/                shadcn/ui parts (ours to edit) and our own small shared parts built from them

ios/                The iPhone app (Expo, iOS only for now). Same feature folder names as web/src.
  src/app/           the routes and start-up (Expo Router)
  src/ui/            tokens, theme and the small parts drawn from them (avatar badge, text)
  src/connection/    server settings, the socket and this install's device registration
  src/bots/, chat/, duo/, settings/    roster, conversation, the folded/unfolded shell, settings
  app.config.ts      development/preview/production variants (bundle id and name per variant)

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
- `shared/` holds protocol definitions at its root and client-only logic in `shared/client/`: `shared/` imports nothing from `server/`, `web/`, `ios/`, or `helper/`, and neither `server/` nor `helper/` imports from `shared/client/`.
- Files stay under about 200 lines and are named for what they do.
- `tests/structure.test.ts` fails when an import breaks these rules.

## Status

**Paused since 27 Nov 2026.** Read [docs/paused-2026-11.md](docs/paused-2026-11.md) first: what is live, parked PRs, resume order.

Built: roster, create bot, Setup panel (toolsets and connectors read-only; skills with per-bot switch and reader, #137),
chat with live tool rows, stop and new session, continuous main conversation per bot across devices, three-column shell
(Activity, Library, Setup), bot menu, delete confirmation, Settings, chat attachments, LilBot memory with Settings > Memory
page and after-chat review, system note and LilBot MCP tools, delegation, same-bot workers and temporary groups (#133) with
screens (#65, #135, #136, Paper "22 Workers"), Routines screens (#53), Library screens (#54), Webhooks screens (#138),
Work board, Check levels and Goals screens (#141, #142, #143), message cost & context size screens (#180), and backends
for routines, webhooks, threads, library, skills, computers/devices, native coding (legacy T3 Code behind
`LILBOT_T3_ENABLED=1`) and bot-added MCP services (#187).
Next: webhook capability switches (Paper "17" frames 7–9, awaiting Oscar's approval), engine-skills switch screen (#140),
check-level track record and spot checks (#142), nightly memory tidy-up and editing abilities. Reports are not built.
Desktop (Tauri) and iOS (Expo) follow the web app.

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
signing secrets, `<data>/apns/*.p8` (the Apple Push signing key), and `<data>/mcp-credentials.json` (the MCP services' tokens and client secrets). The database holds
signing secrets (an address is computed from the engine token and a nonce, never stored), so copies of data use private
directories and files (0700/0600).

### Hermes

- Do not fork or patch Hermes. Configure it, or build on its API. Shipping a LilBot change never restarts Hermes or
  hand-edits live profiles.
- Its wire contract is `~/.hermes/hermes-agent/apps/shared/src/gateway-contract.openrpc.json` and
  `tui_gateway/contracts/`. Read it before using a new method, and read only fields it declares (Hermes sends
  undeclared extras; never rely on them). Every method, parameter and field LilBot uses is listed in
  `tests/engines/hermes/hermes-contract.test.ts`: add to it when you use a new one. It is Hermes' internal API: after
  every Hermes update run `bun run verify` and `bun run check:live`.
- Never use Hermes' own MCP OAuth (`mcp.servers.oauth.*`) or its token store: LilBot holds every service's sign-in
  (see Connections).
- Put nothing new into Hermes plug-ins. A new bot-facing tool goes on LilBot's own MCP server (`server/system/`), with
  the same service function the screen uses, so a second engine gets it for free; the plug-ins keep only what MCP
  cannot do (pre-compress save, native skill-write lock, and the dumb `lilbot-prompt-v1` `llm_request` pass-through that swaps the outbound system prompt with LilBot's assembled file;
  Hermes loads it only from `plugins.enabled`, see [docs/hermes-engine.md](docs/hermes-engine.md)).
- Mapping onto Hermes: [docs/hermes-engine.md](docs/hermes-engine.md). Engine checklist:
  [docs/engine-contract.md](docs/engine-contract.md).

## Stack

TypeScript on Bun. No Effect, no server web framework, no ORM. Oscar does not write code: optimise for agents and for
behaviour he can check in the app. Keep an eye on speed and memory; measure before optimising.

- Server: plain `Bun.serve`; database `bun:sqlite` directly.
- Web: React + Vite, TanStack Router, Tailwind 4, Zustand, Zod. Built on shadcn/ui (Base UI variant,
  `components.json`) and its AI Elements patterns:
  - Never hand-write a part shadcn has (button, input, menu, dialog, ...). Add with `bunx shadcn@latest add <name>`
    (lands in `web/src/ui/`, alias `@/ui`), run `bun run format`, and delete unused exports to stay under ~200 lines.
  - Chat features first check `https://ui.shadcn.com/docs/ai-elements/base/<name>.md` and compose those parts with plain
    props at the component edge (`chat/chat-item.tsx`); never reshape `chat-state.ts` or `shared/` for a library and
    never add the Vercel AI SDK. Next to adopt when needed: Context, File Tree, Confirmation, Subagent, Plan, Sources.
  - Colours: only shadcn token names (`bg-background`, `bg-card`, `bg-muted`, `text-muted-foreground`, `bg-primary`,
    `text-destructive`, `border`), plus `success` and `hairline` (foreground at 8%). Other tints are foreground
    opacities (`bg-foreground/4` hover, `/6` pressed). Accent blue (`primary`) is only for the unread dot and working
    spinner; switches and primary buttons are ink (`bg-foreground`). Defined in `app/styles.css`; dark mode follows
    `prefers-color-scheme`; bot replies use `prose-chat`.
  - Font: Inter bundled in `app/fonts/` (~48 kB English subsets). Closed type scale: 12 meta/section, 13 previews/menus,
    14 names, 15 chat, 16 panel/dialog titles, plus 28 goal metric display; weights 400, 500, 600. Icons 16px at stroke
    1.75 in 28px buttons (`ui/icon-button.ts`).
  - Bundle budget: chat's first load stays about 220 kB JS and 17 kB CSS (gzip -9, all files `dist/index.html`
    references). Import UI parts as `@/ui/<part>`; keep form pages, details tabs, bot menu/dialogs, Settings, model
    menu, image viewer and thread/routine/webhook/library detail views lazy.
  - `bun run build` writes brotli and gzip copies of `dist/`; `server/http/static-files.ts` serves them, hashed
    `/assets/` immutable (404 when missing), `index.html` `no-cache` with ETag.
- Checks: Biome, `tsc`, knip, 200-line file limit, `AGENTS.md` size/link checks, `bun test`, Vite build (`bun run verify`).

## Listeners and trust boundaries

All three listeners bind loopback (`LILBOT_HOST` defaults to `127.0.0.1`), disable development error pages and answer
errors with a plain 500.

- **Private app** (`LILBOT_PORT`, production 3370): app, browser routes, `/ws`, engine API and MCP routes (T3 bridge,
  system server, `/engine/connections/<id>/mcp`). Reached from other devices over the tailnet only (port 8443).
  `server/http/socket-guard.ts` allows `LILBOT_ALLOWED_HOSTS` plus same origin and refuses `cf-connecting-ip`, `cf-ray`
  and Cloudflare `cdn-loop` headers before routing.
- **Helper door** (off by default; `LILBOT_PUBLIC_ENABLED=1`, `LILBOT_PUBLIC_PORT`, production 3372, distinct from
  private port): only `POST /helper/register` (8 KiB), `GET /helper/connect` (WebSocket) and `POST /hook/<address>`
  (256 KiB). No app, browser socket or engine endpoint. Behind Cloudflare the client IP is `cf-connecting-ip`.
- **Access listener** (off by default): `LILBOT_ACCESS_ENABLED=1` with `LILBOT_ACCESS_PORT` (3373, distinct),
  `LILBOT_ACCESS_HOST`, `LILBOT_ACCESS_TEAM` (`<team>.cloudflareaccess.com`), `LILBOT_ACCESS_AUD` and
  `LILBOT_ACCESS_EMAIL` (service env only; invalid settings halt startup). Serves the app, browser routes and `/ws`.
  One opt-in route exists only here when `LILBOT_ACCESS_CALLBACK_ENABLED=1` (off by default; paste fallback works
  without it): `GET /api/connections/callback` (runs only after Access JWT checks, plain `no-store` / `default-src
  'none'` page, no cookie, never logs its address; when off, plain 404 `no-store`, never the app shell).
  - Every HTTP request and `/ws` handshake requires a verified RS256 Access JWT in `Cf-Access-Jwt-Assertion` (`/ws` also
    accepts `CF_Authorization`, header wins), checking issuer, audience, expiry/nbf (30 s skew) and email via certs from
    `https://<team>/cdn-cgi/access/certs` (10 min cache, 30 s refresh/failure cooldown). Invalid/missing tokens or
    Host/Origin mismatch get 403; never log tokens or email. `/engine*` and `/helper*` are always refused.
  - `LILBOT_ACCESS_TEST_CERTS_URL` is strictly for `check:access`/`check:connections` on loopback with isolated dev
    dirs/allowlist; production refuses `*_TEST_*`.
- Never add the helper or Access hostname to `LILBOT_ALLOWED_HOSTS`, and never point a tunnel at the private port.
- File downloads (library, attachments, thread files, helper installers) run only on private and Access listeners (never
  helper door) with Host/Origin checks, no cross-site fetches, attachment disposition, no-sniff, sandbox and no-store.
- **Engine API** (`server/http/engine-api.ts`, `/engine/*` on private listener): loopback only, token from
  `<data>/engine-token`, caller taken strictly from the bot-bound capability (ignores body bot ids, refuses unknown and
  deleted bots). Serves remaining plug-in tools (memory, skills, conversation search) and legacy adapter
  routes; T3, bot-added MCP services and System MCP use per-bot HMAC keys.
- **Cloudflare:** `lilbot-connect` tunnel; touch only LilBot's own tunnels and DNS names. Detail:
  [docs/cloudflare.md](docs/cloudflare.md).

## Foundation model

| Part | Owner | Where it lives |
|---|---|---|
| Identity (name, function), instructions, model, reasoning effort, permission mode, engine binding | LilBot | `bots` table in LilBot's database |
| Skills and per-bot skill switches | LilBot | shared skills library and SQLite |
| Tools and MCP connectors | engine, except LilBot's own connections (T3, system server, bot-added MCP services) | Hermes profile; `server/connections/`, `server/system/` |
| MCP services bots add: list, sign-ins and tokens | LilBot | `mcp_connections` in SQLite; tokens only in `<data>/mcp-credentials.json` (0600) |
| Workspace: one folder per bot on the shared computer | the bot | `~/lilbot/workspaces/<bot id>`, working directory of its chats |
| Conversation: continuous history, one active session | LilBot record; engine working context | SQLite history items & dividers; Hermes keeps model context |
| Memory | LilBot | facts in SQLite; engine reads/writes through adapter |
| Primary bot, avatar, section, pinned, hidden, unread | the user | LilBot's own SQLite database |

- Bots have no type, role or template: instructions differentiate them, and every bot gets the same skills and tools by
  default. "Workspace" means one folder per bot on the leader; other machines are execution environments (Computers).
- Each bot has one permission mode (`full-access` default; only `full-access` is supported now; unsupported choices fail
  before saving). LilBot applies it on creation, startup, edits, chats and reviews, repairing drift. Routine runs use
  full access; webhook runs are narrow by default (see Webhooks). There are no approval cards, and LilBot bots do not
  require approval for App Store Connect / Apple submissions; engine hard stops remain.
- One primary bot (defaults to engine's default bot) sits first in the roster and opens on app entry; bots answer whoever
  gave them the work. Any bot creates bots via `lilbot_bot_create` (inheriting its model, request-id idempotent, hidden
  first prompt starts its greeting).
- Long conversations are the engine's job (Hermes compresses at 50% context; LilBot never summarises). Sidebar state
  (pin, section, unread, hide) belongs to the user; live activity is separate from unread and computer health.

## How the server works

Full server mechanics, model/reasoning effort rules and bot deletion teardown: [docs/server.md](docs/server.md).

- Layers: `http/browser-session.ts` (typed handler map) -> `bots/bot-service.ts` -> engine and SQLite stores
  (`server/database/migrations.ts`: append-only migration steps, default `~/.local/share/lilbot/lilbot.db`).
- `bot-runtimes.ts` caches runtime availability/abilities; roster and detail reads never wait for engine calls. Startup
  (`runtime-readiness.ts`) prepares only non-deleted DB bindings in the background (primary first, then 5 at a time;
  backoff retries on failure; `BotRuntimes.use` waits only for that bot's flight). Identity is imported once, then
  LilBot wins; model and effort edits validate before saving and apply in place via `session.mutate` (refused switches
  return `confirm_required` after saving; never auto-confirmed).
- Activity (`server/activity/`) tracks live session state and durable per-bot unread (`bots.changed` pushes; each
  feature has `<feature>.changed`). Background timers (`background.ts`) catch errors and log fixed task labels only.
- **Deleting a bot (`bot-deletion.ts`):** primary and engine-default bots cannot be deleted. Saves a tombstone first
  (capabilities, uploads, webhooks and library access stop at once), removes runtime, conversation/journal, routines,
  webhooks and skill switches, cancels active computer requests, archives or deletes files (`files: archive|delete`,
  `privateMemories: forget|keep`), and keeps shared facts, attribution metadata, thread/work/goal records, authored
  skills, system change logs and bot-added MCP services.

## Web app

Visual specs, Paper frames and full client behaviour (shell, rail, menus, details panel, model picker, feature views,
scroll and history): [docs/screens.md](docs/screens.md).

- Wide screen: three columns (roster 272px, conversation max 680px, details panel 332px); collapsible 64px rail (lazy;
  desktop only). Pinned tiles appear once any bot is pinned (primary first, then `pinnedAt` order); sections plus
  collapsed Unassigned/Hidden below.
- `/bots/$botId` is a layout route keeping the chat mounted while tabs (`/bots/$botId/$tab`) or column overlays
  (`?thread=`, `?run=`, `?webhookRun=`, one at a time) open. Composer has files, lazy model/reasoning pill, lazy
  context meter pill and send/stop; AI Elements' Message Scroller anchors only messages sent while open, memoises rows
  by position and preserves scroll when earlier history pages load above.
- Feature panels live in lazy chunks: Skills (Setup tab, #137), Routines & Webhooks (Activity tab, #53/#138; webhook
  addresses are fetched only on Copy click), Library (All/Media/Files, sandboxed page viewer, read-only workspace
  browser, #54) and Work between bots (conversation cards, opened exchanges/groups, "Working together", #65/#135/#136).

## Conversation history

Full journalling, importer, `#180` usage/compaction and `#148` pre-compress checkpoint details:
[docs/history.md](docs/history.md).

- `server/history/` keeps an append-only SQLite record per bot via live event journalling plus a background importer
  (one 100-row page/bot/s; operator `bun run history:exclude` removes non-main sessions). Only sessions LilBot opened,
  the bot's pre-LilBot sessions and their continuations are recorded; chats from the engine's own apps never are. Hidden sessions (routines,
  webhooks, threads, reviews) and their compression continuations (`bots/hidden-chats.ts`, fail-closed on unreadable
  lineage) are excluded from history, activity and memory reviews.
- `chat.open`/`chat.new` preserve `items` and add paginated `history`; `chat.history` pages newest-first with stable
  bot-bound cursors. `#180` adds per-turn `usage` (`TurnUsage`), `Bot.context` (`{ used, window }`) and `compaction`
  items. Empty sessions omit dividers except the active main session.
- **Memory save before compression (#148):** connected bots are fail-closed (`compression.checkpoint_required`); Hermes
  runs `/engine/history/save` in ~100k-char passes on `LILBOT_REVIEW_MODEL` before compacting. Outages retry for 90 s;
  if the save fails, the turn stops cleanly (`failure: memory_save`) rather than forgetting.

## Threads and temporary groups

Full delegation, files, engine findings, concurrency and temporary group rules: [docs/threads.md](docs/threads.md).

- `server/threads/` owns bot-to-bot exchanges and same-bot workers (`lilbot_delegate` with `to` or `worker: true`,
  `lilbot_delegation`) and temporary groups (`lilbot_group`, #133, 1 leader + 2–4 members). Receivers and workers run in
  hidden sessions (workers open a `code` work item, may override `model`/`reasoningEffort`, and cannot spawn workers,
  delegations or groups); MCP calls are matched to their exact `tool.start` (`calling-chats.ts`, refused as
  `session_unknown` if unmatched, #174).
- Control (status, cancel, redirect, wait) belongs to the delegating bot; Oscar reads (`threads.list`/`open`) and may
  stop (`threads.cancel`), never writes. Files copy safely with `O_NOFOLLOW` and SHA-256 verification; bot text passes
  safety checks and is JSON-fenced. Limits (`thread-limits.ts`): depth 3, 20 msgs/exchange, 6 concurrent work deliveries
  (4 workers; answers/notices unstarved), 8 open exchanges/bot (3 workers); groups: 4 members, 6 rounds, 40 msgs, 120
  min, 15 min quiet, 2 active/leader.

## Work and check levels

Full board rules, session attribution, drop/answer routing and `#142` check-level mechanics: [docs/work.md](docs/work.md).

- `server/work/` tracks every real piece of bot work (`lilbot_work`, `lilbot_work_list`; `lilbot-work` skill): owner,
  asker/origin from LilBot's session records (`workSessions`, `sessionRoots`), "done" definition, kind, check level
  (0–3), evidence pointers, result and status (`open`, `working`, `checking`, `needs_oscar`, `done`, `failed`, `dropped`).
  Delegation and groups open child items automatically; `work.drop` cascades in one transaction. Screens:
  `web/src/work/` ([docs/screens.md](docs/screens.md)).
- **Check levels (#142, `lilbot-check` skill):** 0 none (`reply`, `note`), 1 owner evidence (`file`, `computer`, `code`),
  2 second bot reproduces claim (`deploy`, `outside`, `spending`, `figure`; falls back to a fresh isolated same-bot
  session on `LILBOT_REVIEW_MODEL`), 3 Oscar (`work.pass`/`work.sendBack`). Check sessions (`#174`) get no memory,
  the `access: 'check'` scope only, and MCP blocks all writes except the assigned verdict.

## Goals

Full agreement, review routine and progress rules: [docs/goals.md](docs/goals.md).

- `server/goals/` (#143, guide topic `goals`): a bot proposes an agreement, measured target with baseline evidence and
  review rhythm (`lilbot_goal`, conversation sessions only). Nothing proactive runs before `goals.agree`; proposals wait
  for Oscar (`goal:<id>` unread). Screens: `web/src/goals/` ([docs/screens.md](docs/screens.md)).
- Once agreed, `goal-routines.ts` maintains a LilBot-owned review routine (`createdBy: oscar`, synced every 5 s).
  Reviews come only from that routine, become level-2 `figure` work items, reject stalled progress without a proposed
  change/drop, and reach the goal only after the review's work item is checked `done`.

## Restart recovery

Full per-feature recovery steps: [docs/server.md](docs/server.md#restart-recovery).

- Restarting LilBot leaves Hermes turns and T3 tasks running without resubmission. Browsers reconnect and reconcile the
  main conversation (a new session starts only if Oscar asks or two attach attempts confirm "not found"). Routines,
  webhooks, threads, work answers/drops, goal ticks and the T3 grant all resume from SQLite/data using persisted
  admission/request ids; in-memory MCP OAuth sign-in links expire on restart and pending MCP tool applies run on next
  chat open. Unknown engine receipts fail explicitly rather than repeating side effects.

## Deploy

Internals, machine install, overrides and manual recovery: [docs/deploy.md](docs/deploy.md).

- Production runs only from `~/lilbot/release` -> `~/lilbot/releases/<commit>` (immutable, built via `git archive` from
  a verified clean commit). Only `bun run deploy` builds releases and restarts `lilbot.service`.
- Procedure: commit, then `bun run verify && bun run deploy`. Watchdog (`lilbot-deploy.service`) backs up SQLite via
  the online backup API, swaps symlink, restarts and monitors health for 60 s; on failure it restores DB, clears
  `compression.checkpoint_required` on bound non-deleted profiles (for pre-#148 rollback), swaps back and restarts once.
  Data dir, secrets, `computer-server-key.pem`, workspaces and engine sessions are never replaced. Failed recovery stops
  and keeps the lock for manual inspection; `bun run deploy --status` and failure notices report outcomes.

## Library and chat attachments

Full upload, storage, marker, safety and read rules: [docs/library-and-attachments.md](docs/library-and-attachments.md).

- **Library (`server/library/`):** bots explicitly deliver workspace files via `lilbot_give_file` (session matched to
  its tool start, logged in `system_changes`). Items point to workspace files (never copied), read via descriptor-relative
  `O_NOFOLLOW` opens; `library.workspace` browses read-only without enabling downloads of ungiven files.
- **Chat attachments (`server/attachments/`):** staged per bot (button, paste, drop), `attachments.prepare` + raw PUT
  upload into `attachments/` via `O_NOFOLLOW` exclusive-create with SHA-256 verification and PNG/JPEG/GIF/WebP magic
  checks. `chat.send` requires client UUID `messageId` for idempotency; display-only markers reconcile stored engine text
  at the HTTP edge; non-image files pass as untrusted workspace references.
- **Shown files (`server/shown/`, #317):** `lilbot_show` places an image, video or HTML page from the bot's folder in
  its reply as a `shown` item; LilBot keeps the path (never a copy) and serves it at `/api/shown/` with byte ranges.
  Off by default behind `LILBOT_SHOW_ENABLED=1` until web and iPhone draw every kind.

## Coding

Full native coding, switch and legacy T3 bridge details: [docs/connections.md](docs/connections.md#coding).

- Bots code natively inside LilBot using the `lilbot-coding` skill (`server/threads/coding-skill/SKILL.md`): small
  edits directly, larger work via same-bot workers (`lilbot_delegate` with `worker: true`), or delegation to a project's
  developer bot (`lilbot_bots_list`). LilBot builds no worktree manager or hard-coded model rules; agents decide when to
  use a separate working copy and follow `~/code/home/AGENTS.md` and each repo's `AGENTS.md`.
- T3 Code (`server/connections/t3-*.ts`) is off by default behind `LILBOT_T3_ENABLED=1` during the trial: when off,
  `lilbot_t3` is withheld, `t3-coding` is removed from the library, `/engine/t3/mcp` returns 404, and no system note,
  guide, status tool or webhook prompt mentions T3. Flipping the switch applies connection changes in place to open main
  conversations (`ConnectionApplier.applyBot`); the system note and prompt skill catalogue refresh next session.

## Connections: MCP services bots add (#187)

Full OAuth, discovery, forwarding and in-place apply details:
[docs/connections.md](docs/connections.md#mcp-services-bots-add-187).

- Any bot can add a remote MCP service via `lilbot_connection` (`add`, `sign_in`, `finish`, `remove`, max 20; read via
  `lilbot_status` area `connections`, guide topic `connections`). Every bot gets every connected service under engine
  name `lilbot_c_<name>` (leaving existing profile servers like `revenuecat` and `paper` untouched). Only the adding bot
  removes a service (or any bot once the adder is deleted). Browsers: `connections.status` (`services`) and
  `connections.changed`.
- **Untrusted inputs & SSRF:** names are 2–31 `[a-z0-9_]`; addresses/OAuth endpoints must be HTTPS or loopback HTTP, no
  credentials/fragments/secrets (`memoryRefusal`), internet services cannot target loopback/this machine, and nothing
  follows redirects. Service tool output is fenced as `<outside-service-output>` data, never Oscar's instructions.
- **LilBot-held OAuth, sign-in cards (#216) & tokens:** `add` probes the service; on 401 LilBot discovers auth metadata
  (RFC 9728 / RFC 8414 / OpenID, issuer-checked, same-origin endpoints), requires PKCE S256, registers dynamically
  (RFC 7591 public client; no API keys yet, #63) and places an in-chat `connection.sign_in` card (`connection_sign_in_cards`,
  10 min, single-use `state`, `iss` check, expires on restart; link/state/pasted URL never stored, broadcast, logged or
  given to bots). Browsers manage cards via `connections.signIn.{open,finish,cancel,restart}`. Return URL is
  `https://<LILBOT_ACCESS_HOST>/api/connections/callback` (route off by default, `LILBOT_ACCESS_CALLBACK_ENABLED=1` opts
  in; browser card paste and legacy bot `finish` work without it). Tokens and client secrets live ONLY in
  `<data>/mcp-credentials.json` (0600) — never in chats, logs, memory or engine configs; LilBot refreshes 30 s before
  expiry or on 401.
- **Forwarding & in-place apply:** engines connect to `/engine/connections/<id>/mcp` (private listener, loopback, no
  Origin, per-bot HMAC key, POST/DELETE only, never forwards 401; signed-out answers `connection_status`). A 1 s watcher
  (`connection-apply.ts`, `BotEngine.applyConnections`) updates profiles and applies tool changes in place to open main
  conversations from the next message (no new session), then delivers a hidden `"<name> is connected"` turn.

## System: the note and LilBot's own MCP server

Tool table, token measurements and how to add a tool: [docs/system-mcp.md](docs/system-mcp.md).

- The static ~200-word note (`bots/system-note.ts`) is appended after user instructions when engines apply a bot (kept
  out of stored/displayed instructions; volatile facts live in `lilbot_about`).
- `server/system/` serves `/engine/lilbot/mcp` on the private listener only (per-bot HMAC key, caller strictly from key,
  deleted bots refused). Every `lilbot_*` tool calls the same service function as the UI and logs changes in
  `system_changes`. No destructive tools except a bot deleting its own webhooks/routines or removing an MCP service it
  added. Tool changes update the URL hash so engines reconnect once; drift tests guard tools and `server/system/guide/*.md`.

## Computers and devices

Protocol, rate limits, helper builds/signing, browser installer and "my computer" details:
[docs/computers.md](docs/computers.md).

- `server/computers/` and `helper/`: `leader` runs locally; remote helpers register via one-time install codes pinning
  `computer-server-key.pem` (0600, back up with DB) and connect only through the helper door with signed frames over TLS
  (revocation requires a signed revoke). Every bot may use every computer; requires `full-access`. Hard stops are a
  guard, not a security boundary; machine output is untrusted data.
- **Browser installer (`computers.addThis.*`):** downloads served from `<data>/helper-downloads` on private/Access
  listeners with baked public settings (`helper-settings.json`); code hands over via same-user loopback `:47613`,
  `lilbot-helper://` link or paste. Never put signing identities, notary keys, team id or email in repo, issues or PRs.
- **Devices & main computer (`server/devices/`):** browsers keep a UUID in `localStorage` (`devices.current` on connect)
  and send `deviceId` on `chat.send`. LilBot injects a model-only origin line (`api_text` on Hermes) resolving
  linked computer -> main computer (`computers.setMain`) -> none; bots follow static note rules and ask when offline or
  ambiguous. Stored user messages record `{ deviceId, name }` at send time.

## Skills

Full library, import and `#140` engine-switch details: [docs/skills.md](docs/skills.md).

- `server/skills/` owns the shared `SKILL.md` library (`~/lilbot/skills`, `LILBOT_SKILLS_DIR`) with authorship and
  per-bot off switches in SQLite (default on). New/edited text refuses secrets and hidden characters. Skill tools stay
  on the Hermes plug-in because Hermes' `skill_manage` cannot be disabled alone without patching
  ([docs/hermes-engine.md](docs/hermes-engine.md#skills-plug-in-skills-adapter)).
- `#140` adds a global per-engine "Include this engine's skills" switch (`engine_skills`; on for existing engines at
  migration, off for new engines; `hermes-agent` stays always-on). Screen: `needs-ui`.

## Memory

Full schema, safety rules, plug-in versioning and after-chat review details: [docs/memory.md](docs/memory.md).

- `server/memory/` owns `memory_facts` (`profile` lasting/shared by default, `journal` dated/private by default; pause,
  forget, restore) and `contextBlock` (~1,500 tokens before each turn; rest via `recall_memory`). `memory-safety.ts`
  blocks model instructions, secrets and invisible characters in linear time. Bump `memory-adapter/plugin.yaml` and
  `__init__.py` `VERSION` together when changing the adapter.
- **After-chat review (`memory-reviewer.ts`):** queues finished real-conversation turns (excluding routines, webhooks,
  threads, compression children, sub-agents) and runs a hidden memory-only session on `LILBOT_REVIEW_MODEL` (10 turns or
  3 turns + 2 min quiet; cannot undo user edits; `via: review`). Nightly tidy-up is not built yet.

## Routines

Full schedule, DST, scheduler and browser API details: [docs/routines.md](docs/routines.md).

- `server/routines/` owns app-level schedules (interval, daily, weekly; `Australia/Adelaide` default IANA zone) and
  dispatches through `BotEngine.runRoutine` without touching Hermes cron jobs. Bot tools: `lilbot_routine` and
  `lilbot_routines_list` (caller's own only; max 5 self-created; 5-min minimum; goal review routines excluded).
- Scheduler atomically creates runs, coalesces missed ticks to one, never overlaps, persists hidden full-access session
  aliases and run ids before dispatch (30 s transport retries; unknown outcomes fail explicitly). Short-interval test
  override (`LILBOT_ROUTINE_TEST_INTERVAL_SECONDS`) is forbidden in production.

## Webhooks

Full door order, payload/safety pipeline, capability analysis and run message details:
[docs/webhooks.md](docs/webhooks.md).

- `server/webhooks/` (#12): `POST /hook/<address>` on the **helper door only** (requires `LILBOT_PUBLIC_ENABLED=1` and
  `LILBOT_HELPER_URL`; tunnel ingress in [docs/cloudflare.md](docs/cloudflare.md)). 64-char base64url HMAC addresses
  are never stored or logged; supports `github`, `stripe` and `hmac-sha256` signatures, rate/body/waiting caps, 7-day
  dedupe, address blanking, two-pass safety scans (`outsideReason`) and `<webhook-events>` JSON fencing.
- **Narrow by default, session-scoped forever:** a webhook run reads its bot's folder (`lilbot_workspace_read`) and own
  work items, opens/updates up to 3 items (level 2 checked by Oscar, fenced as `<webhook-work-item>`), and leaves one
  fenced message (`lilbot_webhook_message`, shown in chat, fed on Oscar's next turn, dropped before memory reviews).
  Extra `capabilities` (`web`, `shell`, `computers`, `coding`, `bots`, `delegation`, `memory`, `routines`, `webhooks`)
  are Oscar-only (`webhooks.setCapabilities`, no screen yet). **Granting any group except `web` and `webhooks` gives
  whoever can reach the address full access.**
- Enforcement is **by session and its compression lineage, never by time** (both frozen engine toolsets and fail-closed
  call-time checks in `webhook-callers.ts` / `system/run-access.ts`, returning ordinary `{"refused": ...}` results so
  Hermes never trips its MCP error pause). Bot tools: `lilbot_webhook`, `lilbot_webhooks_list`, `lilbot_webhook_message`
  (max 5/bot).

## Known gaps

- Hermes opens waiting requests (clarify, approval, sudo) only when a client sends `client.capabilities
  {server_requests: true}`; LilBot sends none, so `waiting` status is ready but unused today. If enabled later, the
  Hermes observer must emit on status changes too (`key !== saved` stays false when a blocked request adds no replay
  events). Hermes' out-of-turn `error` event is unmapped (failed turns end with `message.complete` status `error`).
- Activity observation polls every second (at most 200 live sessions/profile in Hermes); very short activity may only
  appear at completion.
- First history import recovers only rows Hermes still exposes (old compression lineages may rotate; 2 MiB row cap).

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
- Files stay under 200 lines (`scripts/size-exceptions.json` may only shrink); `AGENTS.md` stays under its verify limit.
- `bun run verify` passes, including knip and the size/doc-link checks.
- The PR body states the lines and web-bundle delta from the verify growth report.

## Issues and labels

Work is tracked as GitHub issues on this repo, split across threads: a discussion thread files backend issues, an
orchestrator builds them, and a separate UI thread designs screens. The discussion thread does not talk about layout,
so the labels say whether a screen still has to be designed.

- One issue per agreed decision.
- `backend`: server, data and engine work (data and API, never layout). `ui`: screens designed by the UI thread.
  `spike`: investigate and report; nothing ships. `needs-ui`: feature has a screen nobody has designed yet.
- The discussion thread messages the UI thread directly when marking an issue `needs-ui` (issue number, what the screen
  must show and do, where the data is documented — never layout), and messages the orchestrator whenever it files or
  materially changes a backend issue. Labels stay the record and fallback.

Issues are actioned automatically (Oscar, 2026-11-20); nobody has to say "go".

- The orchestrator starts the next open issue whenever a slot is free (at most three builders sharing the dev gateway; a
  spike needing no dev server may run as a fourth; hourly scheduled wakeup).
- Order: discussion thread's explicit queue, then bugs/regressions Oscar reported, then open milestone, then oldest
  first. Respect "Depends on" notes and re-read latest comments before delegating and before merging ("on hold" or a
  rewrite overrides earlier confirmation).
- A `ui` issue is buildable once its Paper design is approved.
- Parts marked "proposed, not confirmed by Oscar": implementation details go ahead (report what was chosen); anything
  that changes Oscar's experience, costs money, deletes/exposes data or touches his accounts is asked via the discussion
  thread first while the rest is built.
- Never automatic, always Oscar's call: paid plans or credits, destructive actions on his data, opening anything new to
  the internet, using his Apple or Cloudflare accounts beyond what he approved, and approving a design.
- Skipped with a note: draft PR #4 (ACP spike) and anything waiting on Oscar. Report every merge to the discussion
  thread.

How screens get designed and closed:

- The UI thread designs the screen on Paper and shows Oscar; no other thread approves a design.
- `needs-ui` never blocks building a backend issue. Once the backend PR is merged, if an approved `ui` build issue is
  already linked, close the backend issue on merge; otherwise keep the backend issue open with `needs-ui` until the UI
  thread gets Oscar's Paper approval, opens and links the `ui` build issue, removes `needs-ui` and closes the backend
  issue.
- `gh issue list --label needs-ui --state all` lists features still awaiting an approved design.

Cleaning up after a merge:

- The merging agent removes its own worktree, local branch and remote branch (squash merges look unmerged to git;
  delete once the PR shows merged). Never touch another thread's unmerged work. Remove abandoned PR branches the same
  way after noting it in the issue.

## Commands

Full walkthroughs of every `check:*` and `bun live-checks/*.ts` script: [docs/commands.md](docs/commands.md). All live
checks use the dev launcher, temporary `dev-` profiles, isolated directories and cleanup in `finally`; run one at a time.

- `bun run verify` / `bun run format`: full check suite (lint, typecheck, knip, size & `AGENTS.md` limits, tests, web
  build, growth report) and Biome formatting.
- `bun run dev:setup`: create/repair `~/lilbot-dev/` and start `lilbot-dev-hermes.service`.
- `bun run dev` / `bun run start`: Vite dev server (proxies to `LILBOT_PORT`, default 3371) / run server.
- `bun run deploy` (`--status`, `--bootstrap`), `bun run t3:sign-in`, `bun run build:helper`,
  `bun run build:helper-downloads [data dir]`, `bun run history:exclude`.
- Live checks: `check:live`, `check:reasoning`, `check:model-switch`, `check:memory`, `check:history`,
  `check:checkpoint`, `check:threads`, `check:delegation`, `check:worker`, `check:groups`, `check:work`, `check:work-drop`,
  `check:checks`, `check:goals`, `check:routines`, `check:webhooks`, `check:restart`, `check:attachments`,
  `check:skills`, `check:computers`, `check:access`, `check:add-computer`, `check:deploy`, `check:system`,
  `check:my-computer`, `check:connections`, `check:coding-native`, `check:coding -- --code-file <file>`, plus
  `live-checks/permissions-check.ts` and `live-checks/library-check.ts`.
