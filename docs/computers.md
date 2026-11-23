# Computers: helper protocol and limits

Detail for `server/computers/`, `shared/computer-schema.ts`, `helper/` and the System MCP computer tools
(`server/system/tool-computers.ts`). The rules
that apply everywhere (the helper door's two paths, secrets, full access, untrusted output) are in `AGENTS.md` under
"Computers and devices" and "Listeners and trust boundaries". Public door hostname and tunnel:
[cloudflare.md](cloudflare.md).

## Records and browser methods

- The leader is always `leader` and runs operations locally through the same bounded runner. Every bot can use every
  computer; the authenticated bot owns its requests, never an id from the body. All computer operations require
  `full-access`.
- Migration 15: computer records, Ed25519 public keys, one-time install codes, replay nonces and durable request
  identities. Migration 16: persistent receive allowances and an active-only bot request index.
- Browser methods `computers.list`, `computers.installCode`, `computers.downloads`, `computers.commandLine.start`,
  `computers.remove`, `computers.addThis.*` and the `computers.changed` push exist; Settings > Computers
  ([screens.md](screens.md)) lists machines live (showing each machine's detected coding engines), removes after
  confirmation, guides "Add by command line" with a verified zero-secret command and hidden code prompt, and runs the
  three-step "Add this computer" dialog. Helpers connect only through the helper door.
- `computers.commandLine.start({ name, system })` and `computers.addThis.start(...)` create an attempt whose
  `computers.addThis.status({ attemptId })` polling is scoped strictly to the browser WebSocket session that created it
  (command-line attempts never link the browser's "this device" mapping). `computers.installCode({ name })` remains
  available for scripts; all codes last 10 minutes and are single use. The minted name wins over the helper's advisory
  hostname. OS is an enum; home is at most 512 characters with control and hidden formatting characters refused.
  `keyConflict` reports a competing key connection.
- LilBot creates `computer-server-key.pem` (0600) in its data directory; back it up with the database and preserve it on
  redeploy.
- Computer hard stops are enforced by LilBot in `ComputerService.submit` (`server/computers/command-safety.ts`) for
  every caller regardless of engine. They are a guard for full-access bots, not a security boundary: write/copy
  operations do not enforce protected-path refusals, and full-access bots share the OS user's authority. Machine output
  is untrusted data.
- Deliver the helper binary and its `.sha256` from a trusted channel; the sidecar detects corruption, not tampering.
- A failure to retire the legacy Hermes computers plug-in on an existing profile is logged without making the bot unavailable.

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
  a signed revoke. The helper aborts work, deletes its identity file first, then removes its service (launchd: boot out
  by label, then delete the plist; systemd: disable, delete the unit, reload, stop; every step best effort) and exits on
  a verified revoke, also after offline removal, so it can be added again. Reconnect backoff resets only after verified server proof.
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
- System MCP tools (`server/system/tool-computers.ts`): `lilbot_computers_list`, `lilbot_computer_exec`,
  `lilbot_computer_read_file`, `lilbot_computer_write_file`, `lilbot_computer_list_folder`,
  `lilbot_computer_request_read`, `lilbot_computer_cancel`, `lilbot_computer_copy`. Legacy `/engine/computers/*` routes
  are retired (HTTP 410).

## Building and installing the helper

- Native: `bun run build:helper`. Cross-compile: `bun scripts/build-helper.ts bun-darwin-arm64
  dist/lilbot-helper-macos-arm64` (x64 also supported).
- Install: `./lilbot-helper install <https-origin>` with the install code on stdin. A downloaded (baked) build refuses
  any origin other than its own door. macOS uses launchd, Linux systemd
  user units. Config and journal: `~/.config/lilbot-helper` (`LILBOT_HELPER_CONFIG_DIR` overrides).
- Updating stops the service, checks SHA-256, writes and chmods a sibling temporary file, renames it atomically, then
  starts the service. `./lilbot-helper reset` removes the local identity, then uninstalls the service, for
  re-registration with a fresh code, keeping execution receipts.

## Adding a computer from its browser

Oscar opens LilBot on the machine, chooses "Add this computer", downloads the installer, opens it, and the computer
appears. No terminal on macOS. The command-line install (`computers.installCode`) stays for headless machines. This is
the detail for the screen (#68), the hand-over, the builds and signing.

- `computers.addThis.start({ name, system, deviceId? })` mints an ordinary install code (single use, 10 minutes) for an
  attempt and returns the downloads for that system, or `supported: false` (`system`: not macOS or Linux;
  `unavailable`: no installer built for this LilBot). `computers.addThis.status({ attemptId })` answers waiting,
  registered, connected or expired, with the computer once one registered with that attempt's code (migration 23 links
  them).
- Downloads are served from `<data>/helper-downloads` at `/api/computers/download/<file>` on the private app and the
  Access listener with the socket's Host/Origin checks and no cross-site fetches; never on the helper door. A build is
  offered only while its sidecar's settings hash matches the server's current settings.
- An installer is the same file for every machine and carries no secret. It carries this LilBot's public settings, baked
  in at build time and written by the server to `helper-settings.json`: the helper door origin (`LILBOT_HELPER_URL`,
  required for the feature), the exact page origins allowed to hand over (the non-loopback `LILBOT_ALLOWED_HOSTS` names
  and the Access name over HTTPS; loopback pages only in development) and the server key fingerprint. The helper never
  registers anywhere else, so a page or local process cannot point it at another server. Changing those settings means
  rebuilding the downloads.
- Hand-over of the code, first that works: (1) the opened helper listens on `127.0.0.1:47613` for 10 minutes and accepts
  one code, only from an allowed Origin with the loopback Host, only from a socket owned by the same OS user; (2) a
  `lilbot-helper://register#<code>` link handled by the macOS app; (3) the same short line pasted into the installer's
  window. The page holds the short code (no fingerprint); it never goes into a logged URL, argv or a log. A port already
  taken by something else disables (1). Registration itself is unchanged: HMAC and the helper's fresh key proof through
  the helper door.
- Signing secrets rule: identity and notary key (path, key id, issuer id), team id and email come from that Mac's
  environment or a local file outside the repo; never put them in the repo, issues or PRs.

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
  A `lilbot-helper://` link on a registered Mac does nothing but say it is connected: any page or local program can
  open one, so only opening the app updates.
  A later version can compare `hello`'s `version` with the offered build.
- Linux: `lilbot-helper-linux-<arch>.tar.gz` (binary and `.sha256`). Unpack and run `./lilbot-helper` in a terminal:
  the same setup with the terminal as its window and a systemd user unit at the end.

### Building and signing

- **Rollout and rollback order:** deploy the server first; build, publish, or upgrade helpers after. Existing older
  helpers keep working against a newer server, but a newer helper cannot register or stay connected against an older
  server that does not recognise its reported fields. Rolling the server back past a change to what helpers report
  needs helpers built from the same older code.
- The server writes `<data>/helper-settings.json` at start-up when `LILBOT_HELPER_URL` is set. Rebuild after changing
  `LILBOT_HELPER_URL`, `LILBOT_ALLOWED_HOSTS`, the Access host or the server key: old builds stop being offered.
- Command-line helper archives (Linux `x64`/`arm64` and macOS `arm64`/`x64`, `HELPER_VERSION = '2'`), built on the
  leader: `bun run build:helper-downloads [data dir]` (default `LILBOT_DATA_DIR`). Produces flat `.tar.gz` archives
  (`lilbot-helper-<os>-<arch>.tar.gz`, holding only `lilbot-helper` and `lilbot-helper.sha256`) and `.json` sidecars
  beside them without touching `LilBot-Helper-macOS.zip`. `HelperDownloads` verifies each offered file's on-disk
  SHA-256 against its sidecar before listing or serving it, serves only on the private and Access listeners (never the
  helper door), and exposes `privateOrigin` from non-loopback `LILBOT_ALLOWED_HOSTS` only (never the Access host).
- Command-line install flow (`web/src/computers/command-line-script.ts`, `helper/code-prompt.ts`):
  - Private network (Tailscale): subshell (`set -e; umask 077; mktemp -d` with `EXIT`/`INT`/`TERM` cleanup trap) fetches
    via `curl -fsSL --proto '=https' --max-redirs 0`, verifies the server's exact SHA-256 (`sha256sum -c` on Linux,
    `shasum -a 256 -c` on macOS) before extracting only `lilbot-helper` and `lilbot-helper.sha256`, and runs
    `lilbot-helper install <door>`. Nothing secret enters the command or shell history; on an interactive TTY,
    `lilbot-helper install` turns terminal echo off (`setRawMode(true)`, restored on exit/SIGINT/SIGTERM), prompts
    "Paste only the one-time code from LilBot", and rejects pasted commands locally without echoing them. Piped stdin
    keeps working for scripts and tests.
  - Outside private network: browser downloads the `.tar.gz` over its existing session, user copies it (`scp`) to the
    target machine's home folder, and runs the same SHA-256-verified local command. On macOS, `curl` does not attach
    `com.apple.quarantine`, whereas a browser download unpacked locally on the same Mac can carry it; the outside-network
    macOS command clears `com.apple.quarantine` on `$d/lilbot-helper` only after `shasum -a 256 -c` succeeds.
- Signed macOS `.app` bundle (for double-click "Add this computer" only; untouched by `build:helper-downloads`), on a
  Mac with Xcode command-line tools and Bun, from a checkout of the same commit:
  1. Copy the server's `helper-settings.json` to the Mac (public data).
  2. Provide the signing settings, outside the repo, as environment variables or keys of
     `~/.config/lilbot-signing/signing.json` (0600; `LILBOT_SIGNING_CONFIG` moves it): `LILBOT_SIGN_IDENTITY` (the
     Developer ID Application identity in the keychain), `LILBOT_NOTARY_KEY_PATH` (App Store Connect API key `.p8`),
     `LILBOT_NOTARY_KEY_ID`, `LILBOT_NOTARY_ISSUER_ID`.
  3. `bun scripts/sign-macos-helper.ts --settings <helper-settings.json> --out <dir>`. It builds both helpers with the
     settings baked in, signs them with the hardened runtime and only Bun's JIT entitlements (`allow-jit`, `allow-unsigned-executable-memory`), compiles and signs the
     launcher, signs and verifies the app, starts the helper (`version`), notarises with `notarytool --wait`, staples,
     re-zips, checks Gatekeeper and writes the zip and its sidecar. It prints no identity, key or team. `--extra-entitlements` also allows dyld environment variables and disables
     library validation: use it only if the helper fails to start without them.
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

## My computer: devices and the main computer

The rules are in `AGENTS.md` ("My computer"). Code: `server/devices/`, `shared/device-schema.ts`. Migration 24.

- **Records.** `devices(id, name, computer_id, last_seen)`: the id is a UUID the client keeps; `devices.current` makes the
  record on the first call and ignores `name` afterwards; a device not seen for 180 days is forgotten. A link to a
  computer that was removed counts as no link (computer ids are never reused). `main_computer` holds one row at most
  (`CHECK(only = 1)`), so one computer is main; removing it clears the mark. Migration 24 only creates tables and is
  repeatable, so the older migration tests that upgrade from a rolled-back file keep working. Nothing here is a security boundary: the
  device id comes from the browser, and the private and Access listeners are already Oscar-only.
- **Methods.** `devices.current({ deviceId, name })`, `devices.rename`, `devices.linkComputer({ deviceId, computer |
  null })`, `computers.setMain({ computer | null })`. `Device.resolves` is the answer the bot gets for "my computer"
  (`linked`, else `main`, else `none`, each with the computer's name and online state), so the screen's line under the
  card and the bot read the same thing. `devices.changed` and `computers.changed` pushes.
- **Auto-link.** `computers.addThis.start` takes `deviceId`; `computer_attempt_devices` remembers it per install code,
  and when the computer registers with that code `ComputerAuth.registered` ties the device to it (set by `createDevices`).
- **The origin line.** `chat.send` takes `deviceId` (and `messageId` for a plain message; one is made when absent). The
  engine gets `TurnOrigin { line, device? }` beside the text: `[LilBot origin: sent from the device "<name>", which is the
  computer "<name>" (id <id>, online|offline).]`, or `..., which is not a connected computer.]`; a device LilBot does
  not recognise, a routine run and another bot's message each have their own line. Names are JSON-quoted. Hermes puts
  the line in `api_text`, so the model reads it and the stored transcript keeps only what Oscar typed (checked on the
  development gateway: the transcript, `display_messages` and the session title hold the typed text only).
- **Stored per message.** `ChatItem` (user) and `AttachmentMessage` carry `origin: { deviceId, name }`, the name at send
  time. A message with files keeps it in its `attachment_messages` record (exact, by the existing marker). A plain
  message has no id in Hermes' transcript rows and its text is never changed to add one, so `message_origins` holds it
  (bot, text, device, time) until the importer's projection matches a row: the oldest waiting message of that bot with
  the same text, sent no more than six hours before the row. The match is remembered by row id and its text is dropped,
  so reading a page again gives the same answer. Waiting messages older than six hours, and those the engine refused,
  are removed. A message from another client with the same text can only be mistaken for one of ours while one is
  waiting. The `user.message` event is also published for plain messages.
- **Bot-facing.** The standing rules live in the note and `server/system/guide/computers.md`: a computer named in the
  message, else the origin device's, else the main one; ask Oscar in the reply (not with a tool: LilBot draws no card
  for one), listing computers by name, when it is offline, none can be told or the words fit several; never guess for a
  command that changes something; say which computer was used. `main` is on `lilbot_about`, `lilbot_status` and the
  `lilbot_computers_list`. The note's existing line of computer names is unchanged; the rules add no online
  state and no main mark, so a computer coming online or becoming main never rewrites any bot's instructions.
- **Browser client (`web/src/devices/`, [screens.md](screens.md)).** The browser keeps its device id in `localStorage`
  (`devices/this-device.ts`, made on first use; name max 100 chars, no control or hidden chars) and registers it with
  `devices.current` on every connection; every `chat.send` carries it and a client `messageId`, so the `user.message`
  event fills in the sent message, and a message from another device or tab joins the conversation live. Settings >
  Computers starts with "This device" (name, "Runs on", the line from `resolves`); the list has the Main tag and "Make
  main"; the last step of "Add this computer" has the "Make it my main computer" switch. A user message from another
  device shows "from <name>" under it, as plain text.

## Worker hosting on added computers

Code: `shared/worker-frame-schema.ts`, `helper/worker-*.ts`, `server/computers/worker-door.ts`, `server/http/public-door.ts`.
macOS and Linux helpers are covered; Windows is not covered (process-group termination and private file permissions assume POSIX).

- **Capability advertisement:** the helper probes installed coding agents at registration and on connect, advertising
  `'worker'` in `ComputerHello.capabilities` and their `{ driver, version }` entries in `workerAgents` (also refreshed
  via signed `worker.capabilities` frames). A computer with no coding agent stays usable for commands and simply omits
  the `worker` capability.
- **Driver interface and per-driver folders:** `helper/worker-driver.ts` defines the engine-neutral `WorkerDriver`
  contract; concrete drivers and detect-only probes live under `helper/drivers/<id>/` and register only in
  `helper/drivers/registry.ts` (declared on the leader only in `server/computers/remote-worker-drivers.ts`).
  `helper/drivers/claude-code/` implements the Claude Code CLI driver (`claude -p --output-format stream-json
  --input-format stream-json --verbose --permission-mode bypassPermissions --strict-mcp-config --mcp-config <file>
  --model <model>` with optional `--effort`, `--append-system-prompt`, and `--resume`), and `helper/drivers/hermes/`
  implements the Hermes canonical-gateway driver (passing `no_mcp` so personal `config.yaml` MCP servers are never
  inherited, holding LilBot's scoped MCP tools in gateway RAM via `editor.mcp_servers`, and refusing fast when
  `compression.checkpoint_required` is enabled). LilBot passes the bot's model and effort through and stores no
  provider key file on added computers: the agent uses whatever sign-in that machine already has, and model refusals
  surface as a failed worker with the agent's plain reason.
- **Session files:** the Claude Code driver intentionally leaves Claude Code's own session persistence enabled (it does
  not pass `--no-session-persistence`) because follow-up turns and post-interrupt recovery depend on `--resume
  <session_id>`. Claude Code manages those files under its own home folder; LilBot never writes secrets into prompts
  and deletes each run's `0600` MCP config file in `finally`.
- **Per-run loopback MCP proxy (`helper/worker-mcp-proxy.ts`):** binds `127.0.0.1:0` with a fresh random bearer token
  verified in constant time, refuses `Origin`, non-loopback `Host`, and paths other than `/mcp`, streams and caps bodies
  at 256 KiB with an explicit idle timeout, caps concurrent in-flight calls at 16, answers `server/discover` cleanly,
  forwards JSON-RPC requests as signed `worker.mcp.request` frames over the helper's existing WebSocket, retries briefly
  while disconnected (failing already-sent calls with their original JSON-RPC id on disconnect to avoid duplicate side
  effects), and stops immediately when the run ends. The bearer token is never logged or sent in any frame, and stale
  per-run config files are wiped at helper startup.
- **Same-user trust boundary:** two concurrent workers on one computer run as the same OS user with full permissions
  (`--permission-mode bypassPermissions`), so one worker can read another concurrent worker's `worker-runs/*.mcp.json`
  token file (and the helper's `identity.json`). That is inherent to the single-user, full-access machine model.
- **Bounds, recovery and revocation:** workers are capped separately from commands (`WORKERS_PER_COMPUTER = 2`),
  `systemPrompt` is bounded to 96 KiB UTF-8 (below Linux's 128 KiB single-argument limit; the leader must validate and
  truncate before sending, and if an invalid or oversized `worker.start` still arrives, the helper replies with a failed
  `worker.done` instead of closing the socket), `worker.event` updates coalesce to at most one frame per 350 ms per run,
  and the leader door enforces 250 ms event spacing, per-run MCP request rate limits (burst of 10, refilling at 4/s), a
  1 MiB cap on `worker.done`, active-peer-only routing (rejecting unproven contender sockets and notifying a promoted
  peer so it re-sends capabilities and unacknowledged outcomes), and rejects any frame whose `runId` was not started by
  the leader on that computer. All agent-derived strings pass through a single cleaner that strips control and invisible
  formatting characters and scrubs the run's MCP bearer token both before and after stripping, and every outgoing worker
  frame is validated against the shared leader schema before persisting or sending. `worker_runs` in `requests.db`
  prevents duplicate spawns on reconnect and preserves unacknowledged `worker.done` outcomes (strictly capped at 32
  pending rows), and a signed `revoked` frame stops all active worker process groups (`SIGTERM`, escalating to
  `SIGKILL` after 2 s, with a bounded stdout/stderr drain timeout) and closes their proxies before retiring the helper.
- **Leader-side runner and scoped MCP (`server/computers/remote-worker-*.ts`, `server/system/worker-mcp.ts`):**
  `RemoteWorkerRunner` persists active runs in `remote_worker_runs` (schema step 39) with their assigned `computer_id`,
  `bot_id`, `thread_id`, `chat_id`, and latest driver `session_id` (for `--resume` continuations). It assembles the
  starting system prompt (bot instructions with a short remote-specific note, optional `lilbot-coding` skill, fenced
  recalled memory, and offered skill index, all XML-escaped) within 96 KiB UTF-8 and validates the whole
  `WorkerStartFrame` before sending. Removing a computer settles its active runs immediately even while offline, and a
  stopping run refuses every tool call (HTTP 409) and settles as `stopped` regardless of what the helper reports. Every
  inbound frame is validated and sanitized structurally using the shared invisible-character definition from
  `memory-safety.ts`: tool events map to fixed worker activity labels (never raw agent strings), and `worker.done.items`
  accepts only `assistant` and `tool` items (capped at 500 items, dropping `user`, `compaction`, `error`, and
  `connection.sign_in`, and stripping `threadId`/`workItemId`). `worker.mcp.request` is served by `createWorkerMcp` with
  an explicit 6-tool allow-list (`lilbot_work` scoped strictly to `run.threadId` with no verdicts, `lilbot_work_list`
  scoped to own bot's items and own children without goals, `lilbot_memory_list` own bot only, `lilbot_memory_save`
  forced to `scope: 'bot'` with a 10-save per-run cap, `lilbot_skill_read`, `lilbot_guide`; `lilbot_status` is excluded).
  Late or duplicate `worker.done` frames for settled runs on their assigned computer are acknowledged once and ignored;
  unknown or wrong-computer frames are ignored.

## Tests

- `tests/devices/` (device records and limits, the origin line, the message round trip through snapshot, history page and
  event, the importer match), `tests/engines/hermes/hermes-origin.test.ts` and `bun run check:my-computer` (two test
  computers, three devices, a real bot) cover "my computer".
- `tests/computers/add-this-computer.test.ts`, `handover-listener.test.ts` and `bun run check:add-computer` cover the
  browser flow: settings, offered builds, the attempt link, reused/expired/unknown codes, download listeners, refused
  origins and hosts, single use, socket owners and the code staying out of output.

- `bun run check:computers`: real System MCP calls, LilBot command safety stop refusal, retired `/engine/computers/*` 410 check, queue/reconnect,
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
