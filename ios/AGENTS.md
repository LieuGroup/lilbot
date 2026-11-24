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

## TestFlight

Run on macOS from `ios/`:

```bash
# Unsigned release archive check (no Apple account needed)
bun run testflight -- --unsigned

# Signed archive + App Store IPA export (uses installed profile matching bundle id)
IOS_PROVISIONING_PROFILE_NAME="<profile name>" bun run testflight

# Export and upload to TestFlight (never submits for App Store review)
IOS_PROVISIONING_PROFILE_NAME="<profile name>" bun run testflight -- --upload
```

- `APP_VARIANT` defaults to `production` (`com.lilbot.app`) for TestFlight; pass `--variant preview` for `com.lilbot.app.preview`.
- `APP_BUILD_NUMBER` defaults to a monotonic UTC timestamp (`YYYYMMDDHHMM`) when omitted.
- `app.config.ts` sets `ITSAppUsesNonExemptEncryption: false` so TestFlight does not prompt for export compliance on each build, and disables `NSAllowsArbitraryLoads` outside `development` (HTTPS / `wss://` with a trusted certificate is required).
- Signing values (`APPLE_TEAM_ID`, `IOS_PROVISIONING_PROFILE_NAME`, `IOS_CODE_SIGN_IDENTITY`, `IOS_KEYCHAIN` / `--keychain`) stay in environment variables; generated `ExportOptions.plist`, `.xcarchive` and `.ipa` files land under `ios/build/` (gitignored). Pass `IOS_KEYCHAIN=~/Library/Keychains/login.keychain-db` on a Mac with other locked keychains to scope identity lookup and `xcodebuild archive` signing to that keychain.

## Rules

- `ios/` and `android/` native directories are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.config.ts` and config plugins.
- `plugins/with-tab-scroll-minimize.ts` (controlled by `ENABLE_NESTED_TAB_SCROLL_MINIMIZE` in `app.config.ts`) works around `software-mansion/react-native-screens#4145` for iOS 26 nested-stack tab-bar scroll hiding; delete it once `react-native-screens` fixes `#4145` natively without `RNS_GAMMA_ENABLED=1`.
- Minimized tab bar & Work alerts: Option A is active for now — no bottom accessory bar when the tab bar minimizes; the Work tab carries the native system count badge and the bottom stays clean. Keep `NativeTabs` layout clean so Option B (`NativeTabs.BottomAccessory`) remains straightforward to add later if revisited.
- Use `bunx expo install <package>` for dependencies, never a plain package-manager add.
- The app talks to the same LilBot server over its existing socket protocol (`shared/client/socket.ts`); no server changes for a client feature.
- Never test against production or any live bot: point a dev build at a development server with temporary bots only (repo `AGENTS.md`, Safety).
