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
  a signed revoke. The helper aborts work, removes its service and exits on a verified revoke, also after offline
  removal. Reconnect backoff resets only after verified server proof.
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

## Tests

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
