# iOS app

Expo (managed workflow) + React Native + TypeScript, iOS only for now. Part of LilBot: read the repo's `AGENTS.md` first — the project map, the safety rules and the stack notes all apply here too.

## Layout

- `src/app/` — Expo Router routes only (`_layout.tsx`, `index.tsx`).
- Feature folders mirror `web/src/` (`bots/`, `chat/`, `settings/`, ...); `duo/` holds the folded/unfolded adaptive shell, `connection/` the server settings and socket, `devices/` this install's id, `ui/` the tokens and small parts.
- `shared/` (repo root) holds what both apps agree on: `protocol.ts`, the `*-schema.ts` files, `client/` (the socket and chat transcript rules both apps use) and the avatar definitions. Import from there with the `~shared/` path alias; never copy its logic into `ios/`.
- Files stay under about 200 lines and are named for what they do, as everywhere in the repo.

## Commands

Run from `ios/`:

```bash
bun install
bunx tsc --noEmit   # typecheck
bunx expo start     # dev server
```

`app.config.ts` reads `APP_VARIANT` (`development` default, `preview`, `production`) for the app name, bundle id and scheme, so dev and TestFlight builds install side by side.

## Rules

- `ios/` and `android/` native directories are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.config.ts` and config plugins.
- Use `bunx expo install <package>` for dependencies, never a plain package-manager add.
- The app talks to the same LilBot server over its existing socket protocol (`shared/client/socket.ts`); no server changes for a client feature.
- Never test against production or any live bot: point a dev build at a development server with temporary bots only (repo `AGENTS.md`, Safety).
