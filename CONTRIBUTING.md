# Contributing to LilBot

`AGENTS.md` is the source of truth for repository rules, conventions, and architecture for both people and coding agents. Read [AGENTS.md](AGENTS.md) before making changes, and check the linked files in [`docs/`](docs/) for area-specific details.

## Setup

Requirements: [Bun](https://bun.sh/) (`>=1.4.2`, matching `packageManager` in `package.json`).

```bash
bun install --frozen-lockfile
bun run verify
```

The unit tests, typecheck, linter, size checks, and web build run without Hermes or any network service. End-to-end checks under `live-checks/` require a local Hermes gateway configured through `bun run dev:setup`; see [AGENTS.md — Safety: production and development](AGENTS.md#safety-production-and-development) and [docs/commands.md](docs/commands.md).

## Rules that matter

- **Layering and module boundaries:** Requests flow downward only (`http/` -> feature services -> `engines/` and `database/`), `shared/` holds definitions only, and nothing outside `server/engines/hermes/` (except `server/main.ts`) knows about Hermes. `tests/structure.test.ts` enforces these rules automatically.
- **200-line file limit:** Tracked source files stay under 200 lines (`scripts/check-size.ts`). `scripts/size-exceptions.json` may only shrink. `AGENTS.md` also stays within its verify line/byte and link limits.
- **Formatting and checks:** Run `bun run format` for Biome formatting and `bun run verify` before opening a pull request. `bun run verify` runs Biome, `tsc --noEmit`, `knip`, file-size and `AGENTS.md` checks, `bun test tests`, the Vite build, and the growth report.
- **Tests:** Add unit tests in `tests/` in the same change for any logic that can be tested without a browser or Hermes.
- **Public repository hygiene:** Never commit secrets, credentials, tokens, personal emails, private hostnames, or local machine paths (see [AGENTS.md — Secrets](AGENTS.md#secrets)).

## Before you open a pull request

Follow the full checklist in [AGENTS.md — Before you open a PR](AGENTS.md#before-you-open-a-pr):

- No dead code (unused files, exports, parameters, branches, or settings).
- No duplicate helpers, pass-through layers, or single-caller options.
- No comments that restate the code or narrate history.
- No tests that assert nothing real or duplicate another test.
- Keep source files under 200 lines and `bun run verify` green.
- Include the source-lines and web first-load bundle delta from the `bun run verify` growth report in the pull request description.
