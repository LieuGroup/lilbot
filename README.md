# LilBot

LilBot is a single-user web app to chat with and manage your bots, in the style of Grok Bot. It is built for its author's own machine and acts as a client of the [Hermes](https://github.com/NousResearch/hermes-agent) gateway: LilBot never runs a model or an agent loop itself. Running it elsewhere requires a working Hermes gateway.

## Status

- **Built:** bot roster and creation, three-column web shell (Activity, Library, Memory, Setup), Setup panel (read-only toolsets/connectors, per-bot skills switches and reader), chat with live tool rows, stop and new session, continuous per-bot conversation history across devices, bot menu and delete confirmation, Settings, chat attachments, LilBot memory with panel and after-chat review, system note and LilBot MCP tools, bot-to-bot delegation and temporary groups (backend and screens), Routines screens, Library screens, Webhooks screens, and backends for routines, webhooks, threads, library, skills, computers/devices, work board with check levels, goals, T3 Code coding bridge, and bot-added MCP services.
- **Not built yet:** webhook capability switches UI, work board and goal screens, check-level track record and spot checks, nightly memory tidy-up, editing abilities, reports, and desktop (Tauri) / iOS (Expo) clients.

## Requirements

- [Bun](https://bun.sh/) `>= 1.4.2`
- A [Hermes](https://github.com/NousResearch/hermes-agent) gateway as the bot engine (required to run the server or `live-checks/`; not required for `bun run verify` or unit tests)

## Getting started

### Install and run checks

Unit tests, typecheck, linting, structural checks, and the web build run without Hermes or network services:

```bash
bun install --frozen-lockfile
bun run verify
```

Individual check commands:

```bash
bun run lint        # Biome check
bun run format      # Biome format and fix
bun run typecheck   # TypeScript check (tsc --noEmit)
bun run test        # Unit test suite (bun test tests)
bun run build       # Production web bundle + brotli/gzip assets
```

### Run in development

Running the server requires an explicit `LILBOT_ENV` and a Hermes gateway. Development mode enforces isolated directories under `~/lilbot-dev/` and refuses production paths and ports (`server/environment.ts`).

1. Review [`.env.example`](.env.example) for the environment variables the server reads.
2. Prepare an isolated development Hermes gateway (Linux with systemd user services):
   ```bash
   bun run dev:setup
   ```
3. Start the server with your development environment variables set (`LILBOT_ENV=development`, `LILBOT_PORT=3371`, and isolated `LILBOT_*` / `HERMES_*` directories under `~/lilbot-dev/`):
   ```bash
   bun run start
   ```
4. Start the Vite frontend dev server (proxies API and WebSocket requests to `LILBOT_PORT`, default `3371`):
   ```bash
   bun run dev
   ```

See [AGENTS.md](AGENTS.md#safety-production-and-development) and [docs/commands.md](docs/commands.md) for the full development and live-check workflow.

## Architecture

LilBot is written in TypeScript on Bun (`Bun.serve` + `bun:sqlite`) with a React, Vite, TanStack Router, Tailwind CSS 4, Zustand, Zod, and shadcn/ui (Base UI) frontend.

- **Downward layering:** Requests flow from `server/http/` through feature services down to `server/engines/` and `server/database/`. `shared/` holds protocol and schema definitions only. `tests/structure.test.ts` enforces these boundaries.
- **Swappable engine boundary:** Only `server/engines/hermes/` and `server/main.ts` know about Hermes; everything else talks to the engine contract in `server/engines/bot-engine.ts`.
- **Three loopback listeners:** All listeners bind `127.0.0.1` by default — the private app listener (`LILBOT_PORT`), an optional helper/webhook door (`LILBOT_PUBLIC_ENABLED=1`), and an optional Cloudflare Access listener (`LILBOT_ACCESS_ENABLED=1`).

Detailed area documentation lives in [`docs/`](docs/):

- Server, engines, and deployment: [docs/server.md](docs/server.md), [docs/engine-contract.md](docs/engine-contract.md), [docs/hermes-engine.md](docs/hermes-engine.md), [docs/deploy.md](docs/deploy.md), [docs/cloudflare.md](docs/cloudflare.md)
- Web app and commands: [docs/screens.md](docs/screens.md), [docs/commands.md](docs/commands.md)
- Features: [docs/memory.md](docs/memory.md), [docs/history.md](docs/history.md), [docs/threads.md](docs/threads.md), [docs/routines.md](docs/routines.md), [docs/webhooks.md](docs/webhooks.md), [docs/work.md](docs/work.md), [docs/goals.md](docs/goals.md), [docs/library-and-attachments.md](docs/library-and-attachments.md), [docs/skills.md](docs/skills.md), [docs/connections.md](docs/connections.md), [docs/system-mcp.md](docs/system-mcp.md), [docs/computers.md](docs/computers.md)

## Project map

```text
shared/            Protocol and feature schemas shared by server and web (no logic)
server/            LilBot server (Bun.serve + bun:sqlite)
  http/            Listeners, browser WebSocket session, socket guard, engine API
  bots/            Bot service, identity store, preferences, workspaces, runtimes, deletion
  activity/        Live session status and durable unread state
  memory/          Facts table, safety checks, and after-chat review
  history/         Conversation journal, importer, paging, and search
  threads/         Bot-to-bot delegation, temporary groups, and file delivery
  routines/        App-owned schedules, run history, and scheduler
  webhooks/        HMAC-addressed webhooks, signature checks, and fenced runs
  work/            Work board with done definitions, evidence, and check levels
  goals/           Agreed outcomes, measured targets, and review routines
  library/         Delivered workspace files and safe read-only browsing
  attachments/     Incoming chat file uploads and message associations
  skills/          Shared SKILL.md library and per-bot switches
  connections/     T3 Code bridge and bot-added remote MCP services
  system/          LilBot's own MCP server and static bot system note
  computers/       Remote computer identities, keys, and durable command requests
  devices/         Browser/app device records and main-computer resolution
  database/        SQLite connection and append-only schema migrations
  deploy/          Verified release deploy, SQLite backups, and rollback watchdog
  engines/         Engine contract (bot-engine.ts) and Hermes adapter (hermes/)
web/src/           React web app (mirrored feature folders plus ui/ shadcn parts)
helper/            Standalone remote computer helper client
tests/             Automated unit and structure tests
live-checks/       End-to-end checks against an isolated development Hermes gateway
docs/              Area documentation linked from AGENTS.md and this README
```

## Contributing and security

- See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) for development rules, architecture checks, and pull request requirements.
- See [SECURITY.md](SECURITY.md) for private vulnerability reporting and security scope.

## Licence

Licensed under the [MIT License](LICENSE). Third-party copyright and licence notices are listed in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
