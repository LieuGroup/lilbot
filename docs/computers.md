# Computers: helper protocol and limits

Detail for `server/computers/`, `helper/` and the `lilbot-computers-v1` plug-in. The rules that apply everywhere
(the helper door's two paths, secrets, full access, untrusted output) are in `AGENTS.md` under "Computers" and
"Listeners and trust boundaries". Public door hostname and tunnel: [cloudflare.md](cloudflare.md).

## Records and browser methods

- Migration 15: computer records, Ed25519 public keys, one-time install codes, replay nonces and durable request
  identities. Migration 16: persistent receive allowances and an active-only bot request index.
- `computers.installCode({ name })` lasts 10 minutes and is single use. The minted name wins over the helper's
  advisory hostname. OS is an enum; home is at most 512 characters with control and hidden formatting characters
  refused. `keyConflict` reports a competing key connection.

## Rate limits (no edge rule)

- Unknown connect ids are refused before allocating rate-limit entries. Failed authentication and registration:
  20/address/minute. Failed connects: six/(computer, address group)/minute. Valid signatures have a separate
  six/computer/minute budget that stays available when the unauthenticated tables are full. IPv4-mapped addresses use
  IPv4 /32; IPv6 uses /48. At 4096 live unauthenticated groups new groups fail closed without recycling budgets.
  Nonce expiry is indexed.
- Socket message/byte buckets run before parsing. Progress: once per second per request, 8 KiB, 8 active requests.
  Heartbeat/progress spacing uses arrival time before queueing; early frames are dropped without disconnecting.
  Heartbeats at most once per five seconds.
- Behind Cloudflare the client address is `cf-connecting-ip`. An edge rate-limit rule needs Cloudflare Pro; the zone
  is on Free by Oscar's choice, so it has no such rule and LilBot's own limits are the protection.

## Trust and keys

- Registration sends a code identifier and an HMAC over the public key and hello, plus key proof; the raw install
  code never crosses the network. Code consumption is atomic.
- The install code carries the SHA-256 fingerprint of `computer-server-key.pem`: one paste registers and pins the
  server. Every connection proves the fresh helper nonce with that key; frames in both directions sign a
  domain-separated payload digest, connection nonce and ordered sequence. Unauthenticated, altered, replayed or
  different-key work is ignored. Key replacement requires explicit helper re-registration with a new install code.
  TLS is required except on loopback.
- Helpers sign method, path, computer id, timestamp and a one-use nonce (60 s window).
- Revocation aborts work only through a signed `revoked` frame. Unsigned close codes never abort work; server restarts
  preserve remote commands. Revoked public keys stay as tombstones: a reconnect authenticates and receives proof plus
  a signed revoke. The helper aborts work, removes its service and its identity file and exits on a verified revoke,
  also after offline removal, so it can be added again. Reconnect backoff resets only after verified server proof.
- A competing connection suspends dispatch while both receive a three-second challenge. A responsive newcomer
  replaces an unresponsive incumbent; two responsive peers are closed and `keyConflict` blocks dispatch until the
  owner removes and re-registers the computer.
- The helper identity is a 0600 PEM file in a 0700 directory. Keychain is deferred: the built-in `security` CLI's
  shared trust would also allow same-user bot commands; a useful per-helper boundary needs a signed native
  Security.framework integration.

## Requests, queues and storage

- Offline synchronous calls fail at once; explicit background calls queue. Foreground waits stop at 25 s and allow
  five seconds for a disconnected helper to return. Eight 5.6 MB results cannot all arrive in that wait below about
  1.8 MB/s: retry with the same requestId to get the eventual result without re-executing.
- Per bot and computer: at most 32 pending/running/cancelling requests. At most 8 executions per leader or helper.
  Pending dispatch reads only id/status and loads payloads when sent.
- Cancellation of undispatched work settles locally; dispatched work stays `cancelled` until a final result makes it
  `cancel_acked`. The result and `cancelRequested` preserve late outcomes; the helper resends its stored result if
  cancellation arrives after completion.
- Payloads live apart from queue metadata. Completed operations become their SHA-256 digest and size; tool responses
  never echo them. Foreground results expire after five minutes, background results after 24 hours; queued work
  expires after 24 hours with an explicit failure. Indexed pruning handles at most 64 rows or about one large payload
  per tick. SQLite triggers keep global and per-bot (64 MiB) byte totals atomically. Admission enforces the per-bot
  quota only, so four full bots cannot deny a fifth; total disk use scales with bot count. Old backups need separate
  retention.
- Read admission reserves 5.6 MB for its result; operation JSON is capped at 5.7 MB. Omitted results are failed and
  never overwrite workspace files. Results are bounded to 6 MB serialized JSON with an explicit truncation marker.
- Progress stays in memory as a 4 KiB tail; at most eight completed results are cached for active readers. Result
  rows load one at a time.
- Each live request admits at most eight final frames and 48 MB of final-frame payload across all connections and
  restarts. Finished and unknown results are acknowledged without spending that allowance; an exhausted request
  fails with an acknowledgement, never a disconnect.
- Helper journals keep unacknowledged results and admit at most 32 unacknowledged/running operations with worst-case
  space reserved; acknowledgements remove payloads, not execution receipts. Control replies wait for buffer space and
  take priority; a 100 ms pump sends one result at a time, oldest finished first, once per connection; unacknowledged
  results retry after reconnect.
- Heartbeats every 10 s; 35 s without one is offline. Dispatch waits for socket buffer space, checks send outcomes and
  resumes on drain or tick. Commands send a small progress tail once a second and full output only on completion.
- Helper traffic, submissions and dispatch serialize per computer, never behind another computer's queue; workspace
  I/O does not hold those queues. Deleting a bot seeks only its active requests.

## Execution

- Commands have bounded output and a timeout (60 s default, 1 h maximum). Cancellation kills the process group and
  cancels pipe readers, so escaped descendants cannot keep requests busy. Child groups are tracked; an independent
  shell watchdog kills a group after abrupt helper death. Deliberate detachment is not a sandbox boundary.
- Files and copies are capped at 4 MiB; workspace transfers use descriptor-relative, no-follow opens and require
  single-link regular files. Reads return base64; writes accept UTF-8 or base64.
- Plug-in tools: `list_computers`, `computer_exec`, `computer_read_file`, `computer_write_file`,
  `computer_list_folder`, `computer_request`, `computer_cancel`, `computer_copy`.

## Building and installing the helper

- Native: `bun run build:helper`. Cross-compile: `bun scripts/build-helper.ts bun-darwin-arm64
  dist/lilbot-helper-macos-arm64` (x64 also supported).
- Install: `./lilbot-helper install <https-origin>` with the install code on stdin. macOS uses launchd, Linux systemd
  user units. Config and journal: `~/.config/lilbot-helper` (`LILBOT_HELPER_CONFIG_DIR` overrides).
- Updating stops the service, checks SHA-256, writes and chmods a sibling temporary file, renames it atomically, then
  starts the service. `./lilbot-helper reset` stops and uninstalls the service and removes the local identity for
  re-registration with a fresh code, keeping execution receipts.

## Adding a computer from its browser

The rules are in `AGENTS.md` ("Adding a computer from its browser"). This is the detail for the screen (#68), the
builds and signing.

### What the page does

1. Detect the system. `os`: `macos`, `linux`, `windows`, `ios`, `android`, `chromeos` or `other`; `arch`: `arm64`,
   `x64` or `unknown`. Safari always reports an Intel Mac, so `unknown` is normal there; the Mac download is universal.
   An iPad asking for the desktop site also looks like a Mac: `navigator.maxTouchPoints > 1` tells them apart.
2. `computers.addThis.start({ name, system })`. On `supported: false`, show the unsupported-system state (`system`) or
   "not ready" with the command-line link (`unavailable`). Otherwise keep `attemptId`, `expiresAt`, `code`,
   `handoverUrl`, `link` and `downloads` (best first; `url` is same-origin and holds no secret).
3. Download `downloads[0].url` (an `<a download>` or navigation). Show which file to open.
4. Poll `GET <handoverUrl>/v1/hello` about every second while waiting, then `POST <handoverUrl>/v1/handover` with
   `Content-Type: application/json` and `{ "code": code }`. From an HTTPS page, pass `targetAddressSpace: 'loopback'`
   to both `fetch` calls (Chrome's Local Network Access needs it). `hello` answers
   `{ app: 'lilbot-helper', version, state: 'waiting' | 'used' }`; the hand-over answers `{ ok: true }` (200) or
   `{ ok: false }` (422 refused, 410 already used). A rejected fetch means no helper yet, or the browser blocked it.
5. Poll `computers.addThis.status({ attemptId })` every two seconds and on every `computers.changed` push: `waiting`,
   `registered` (helper registered, service starting), `connected` (online: show "<name> is connected"), `expired`.
   `expiresAt` gives the time left.
6. After about 30 seconds without a helper, show the fallbacks: when `downloads[0].link` is true, an "Open LilBot
   Helper" button that navigates to `link` (needs a click: browsers ask before opening an app); and `code` as the one
   line to paste into the installer's window, with Copy and the time left. Show the code nowhere else.

### What each browser does (expected; not yet run on a Mac)

- Run on the Linux leader: Chromium 157 on a loopback dev page did the whole hand-over (CORS preflight, `hello`,
  `POST`, computer connected, listener closed afterwards). An HTTPS page under Local Network Access and Safari are
  untested.
- Chrome 142 and later: the first loopback request from an HTTPS page asks "access other apps and services on this
  device"; allowing it makes path 1 work. Denying it leaves the link and the pasted line. `http://localhost` pages in
  development skip the prompt.
- Safari 18 and later blocks `http://127.0.0.1` from an HTTPS page as mixed content (WebKit bugs 279249, 171934), so
  path 1 is expected to fail there and the link (path 2) carries the hand-over.
- Both browsers ask before opening `lilbot-helper://` links, and the app must have been opened once so macOS knows it.
- Record the real outcome per browser in #60 after the first Mac run.

### The installers

- macOS: `LilBot-Helper-macOS.zip` holding `LilBot Helper.app`: a small universal Swift launcher
  (`helper/macos/launcher.swift`, the main executable and the `lilbot-helper` URL handler), the Bun helper twice
  (`lilbot-helper-arm64`, `lilbot-helper-x64`; a fat Bun executable is unproven) and their checksums in Resources.
  `LSUIElement`: no Dock icon. A zipped app beats a `.pkg`: no Installer steps and no administrator password.
- Opening the app runs `setup`: native dialogs through `osascript` (script on stdin, the pasted line on stdout, never
  argv), the loopback listener and a watch for a link. Links arrive as Apple Events, which only the launcher can
  receive; it passes the URL to `lilbot-helper link` on stdin.
- After registration the service install copies the binary out of the app (App Translocation runs it from a random
  read-only path), checks its SHA-256, removes the copy's quarantine mark and loads the launchd agent. macOS shows a
  "Background Items Added" notice.
- Opened again on a registered Mac, the app replaces the installed binary and restarts the service: the update path.
  A later version can compare `hello`'s `version` with the offered build.
- Linux: `lilbot-helper-linux-<arch>.tar.gz` (binary and `.sha256`). Unpack and run `./lilbot-helper` in a terminal:
  the same setup with the terminal as its window and a systemd user unit at the end.

### Building and signing

- The server writes `<data>/helper-settings.json` at start-up when `LILBOT_HELPER_URL` is set. Rebuild after changing
  `LILBOT_HELPER_URL`, `LILBOT_ALLOWED_HOSTS`, the Access host or the server key: old builds stop being offered.
- Linux, on the leader: `bun run build:helper-downloads [data dir]` (default `LILBOT_DATA_DIR`).
- macOS, on the Mac with Xcode command-line tools and Bun, from a checkout of the same commit:
  1. Copy the server's `helper-settings.json` to the Mac (public data).
  2. Provide the signing settings, outside the repo, as environment variables or keys of
     `~/.config/lilbot-signing/signing.json` (0600; `LILBOT_SIGNING_CONFIG` moves it): `LILBOT_SIGN_IDENTITY` (the
     Developer ID Application identity in the keychain), `LILBOT_NOTARY_KEY_PATH` (App Store Connect API key `.p8`),
     `LILBOT_NOTARY_KEY_ID`, `LILBOT_NOTARY_ISSUER_ID`.
  3. `bun scripts/sign-macos-helper.ts --settings <helper-settings.json> --out <dir>`. It builds both helpers with the
     settings baked in, signs them with the hardened runtime and Bun's JIT entitlements, compiles and signs the
     launcher, signs and verifies the app, starts the helper (`version`), notarises with `notarytool --wait`, staples,
     re-zips, checks Gatekeeper and writes the zip and its sidecar. It prints no identity, key or team.
  4. Copy `LilBot-Helper-macOS.zip` and `LilBot-Helper-macOS.zip.json` into the server's `<data>/helper-downloads/`.
- `--unsigned` skips the Developer ID and notarisation (ad-hoc signature). macOS 15 and later then refuses the first
  open; System Settings > Privacy & Security > "Open Anyway" (then confirm) opens it. Right-click > Open no longer
  bypasses Gatekeeper.

### Threat notes

- Another web page: refused by the exact Origin list (no CORS headers on refusal, so it cannot read anything) and by the
  Host check against DNS rebinding. It may still notice that something listens on the port.
- Another local user: their connection to the helper is refused by socket owner (`/proc/net/tcp` on Linux, `lsof` on
  macOS, which lists only the user's own sockets). A forged Origin from a local process cannot redirect the helper,
  because the door and fingerprint are baked in. Residual risk: another user who binds `127.0.0.1:47613` before
  the helper starts would receive the page's code and could register their own helper in its place; the helper then
  cannot listen and the computer that appears is theirs. LilBot's Macs are single-user; Remove revokes such a key.
- The link puts the code in a `lilbot-helper://` URL, which no server receives or logs; the code is single use for 10
  minutes either way.

## Tests

- `tests/computers/add-this-computer.test.ts`, `handover-listener.test.ts` and `bun run check:add-computer` cover the
  browser flow: settings, offered builds, the attempt link, reused/expired/unknown codes, download listeners, refused
  origins and hosts, single use, socket owners and the code staying out of output.

- `bun run check:computers`: real plug-in calls, Hermes hard-stop refusal before submission, queue/reconnect,
  cancellation, a second door with a different key, signed revocation versus server restart, fast exec, copies,
  reused codes, wrong/revoked keys and private routes/headers.
- `tests/computers/adversarial.test.ts` measures a same-process private `/api/health` listener during signed floods
  with 100k receipts, 1M-row indexed admission, eight parallel 4 MiB copies, eight coloured commands and offline
  storage filling; it also checks delivered bytes and per-bot isolation. It uses five-second flood windows and
  bounded concurrent health probes, weights missed 5 ms probe intervals, and reports p99/max plus total event-loop
  stall above 20 ms. The 250 ms weighted-p99 ceiling is a regression guard that includes large synchronous
  JSON/signature/storage turns, not a claim that every request completes within 50 ms.
- `helper-load.test.ts` runs a real helper three times with a chatty background command and eight parallel 4 MiB
  copies each way, asserting zero disconnects and byte-identical delivery; it prints binary size and idle RSS.

## Real-Mac smoke checklist (not runnable on the Linux leader)

Obtain the trusted arm64/x64 binary, confirm Gatekeeper handling, install with a fresh code and verify the launchd
user service survives logout/reboot; register and check name/OS/home, execute/read/write/copy, sleep and wake during
work and confirm reconnect without duplicate execution, then revoke online and offline and verify the signed revoke
stops work and removes launchd.

For the browser flow: on a Mac without the helper, in Safari and in Chrome, add this computer, open the download
(signed: no warning; `--unsigned`: Open Anyway), and record which hand-over path completed (loopback, link or pasted
line) and the time to online. Open the app again to check the update path keeps the computer.
