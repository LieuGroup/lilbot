# Webhooks

`server/webhooks/` owns webhooks, accepted deliveries and their runs (`shared/webhook-schema.ts`, #12). A webhook
belongs to one bot: a description of what to do when events arrive, the calling service's name (`source`), an optional
signature scheme, and an address. Any sender may call one (Oscar, 2026-11-20). The short version and trust boundaries
are in `AGENTS.md` under "Webhooks"; tunnel ingress is in [cloudflare.md](cloudflare.md); screens are in
[screens.md](screens.md).

## Route, addresses, signatures and door order

- The route: `POST /hook/<address>` on the helper door only (`http/webhook-route.ts`), never the private app or the
  Access listener. Without `LILBOT_PUBLIC_ENABLED=1` and `LILBOT_HELPER_URL`, creating a webhook is refused (no outside
  service could reach it).
- The address is the secret: 64 base64url characters, the webhook id and an HMAC of it and a random per-webhook nonce
  under the engine token (`webhook-address.ts`). It is never stored or logged; it is computed when shown and checked
  with `timingSafeEqual` (one MAC is computed even for an unknown id). A new address draws a new nonce, so even the
  engine token does not give the next one; deletion ends it. The bot gets it from `lilbot_webhook` (`action: create`,
  repeating the same `requestId` returns the current address and any signing secret LilBot made again: that is how a
  lost reply is recovered; and `action: new_address`); those tool results stay in its transcript, so the history copy
  holds them too. The list never has it; the screen copies it with `webhooks.address`.
- Signatures (`webhook-signature.ts`, over the raw body): `github` (`X-Hub-Signature-256`; LilBot makes the secret when
  none is given), `stripe` (`Stripe-Signature`, the secret Stripe gives, five minutes of timestamp tolerance) or
  `hmac-sha256` in a named header (hex or base64, optional `sha256=`). With a scheme set, unsigned or wrongly signed
  deliveries get 401 and leave nothing; refusals are logged by webhook id, at most one line a minute per webhook.
- Order at the door: path shape, per-client-address budget (120 a minute, `cf-connecting-ip`; a full table lets new
  addresses through), address check, paused (409, at once), body cap (256 KiB, by Content-Length or as it streams,
  413), signature, per-webhook budget (60 a minute, spent only after verification), repeat (202 "Already received"),
  waiting cap (100, 429), and only then decoding and the safety check, then 202. Deliveries arriving together are
  prepared one at a time, each in its own turn of the event loop (the webhook looked up again first: paused 409, gone
  404), so a burst never holds the server for its sum. Unknown, malformed or deleted addresses, other methods and a
  deleted bot's webhooks get the same 404 as any other path. Limits: `webhook-limits.ts`.
- Repeats (`webhook-delivery.ts`), remembered for seven days: by the sender's delivery id (`X-GitHub-Delivery`,
  `webhook-id`, `X-Delivery-Id`, `X-Event-Id`, `Idempotency-Key`; for Stripe only the event id in its signed body) and,
  for every signed scheme, by the SHA-256 of the signed body, since id headers are not signed and a body may have no
  id. Unsigned webhooks dedupe by header only (identical alerts from them are legitimate).

## Payload preparation and safety scans

- What the bot is shown (`webhook-payload.ts`, `webhook-decode.ts`): each event becomes one JSON string at receive
  time: JSON decoded and a one-field form body's field decoded (only text that opens with `[` or `{` is parsed), both
  refused past 64 levels of nesting (counted in one pass before parsing: writing a deeper value back blocks the server
  for over a second); at most 8 headers such as `x-github-event`, 200 characters each; every webhook address blanked
  (escaped, percent-encoded once or twice, HTML-entity and fullwidth slashes, whitespace after `/hook/`, the first 64
  of a longer run, and any 16-character piece of the webhook's own address, with any JSON escape the piece starts
  inside, so a split one cannot be rebuilt and the string stays valid JSON; shorter pieces spread over fields, and
  other forms, are not blanked); cut to 24,000 characters inside the fence, headers included.
- Two scans must pass (`outsideReason`, the shared rules plus every format character but the soft hyphen, the three
  flags allowed): one over every decoded string and key as a model reads them (`folded`: whitespace collapsed; every
  mark removed before one NFKD pass, since reordering a long run of marks is quadratic and once blocked the server for
  28 s; compatibility forms folded; default-ignorable characters and marks removed; scanned twice, with other control
  characters as spaces and removed when there are any), and one over the stored string itself. The run's
  `<webhook-events>` fence joins the stored strings unchanged (`fenceJson`: `<`, `>`, control and format characters and
  every default-ignorable character become `\u` escapes). Withheld events keep no payload; a run of only withheld
  events records a failed run and never wakes the bot.
- Preparing any body up to the cap takes tens of milliseconds (`tests/webhooks/webhook-limits.test.ts` times it), and a
  minute's budget of the costliest shapes sent at once never holds the event loop for long (`webhook-burst.test.ts`).
  The rules are a heuristic: paraphrase passes, which is why runs are narrow.

## Runs, batching and retention

- A burst ends after 5 seconds without a new event or once its first event waited a minute. A run takes the oldest
  waiting events up to 48,000 characters (about 12,000 to 16,000 tokens; a typical GitHub `pull_request` event is
  21,700) and 20 events; the rest wait. A webhook never overlaps itself, runs at most once a minute and 20 times an
  hour, and at most two webhook runs go at once across bots. Runs reuse the routines' machinery: persisted before
  dispatch, `RoutineScheduler`, `BotEngine.runRoutine` (hidden session, run id `webhook-<id>`, receipts, retry after 30
  seconds), activity and unread, sessions in `webhook_chats`.
- Kept: the stored event string only until its run settles, but the run's own engine transcript (opened by
  `webhooks.openRun`) and its result keep what the bot saw and said.

## Narrow runs, capability groups and session enforcement

- What a run may do (Oscar, #12 finding 3): narrow by default. It reads its bot's folder (`lilbot_workspace_read`) and
  its bot's own work items, reports on the items its own run opened (`lilbot_work`), leaves its bot one message, and
  its result is its report. No web, commands, file writes, memory, computers, T3 Code, bot creation, delegation or
  groups, routines or webhook management, unless Oscar adds that group to the webhook: `capabilities` (`web`, `shell`,
  `computers`, `coding`, `bots`, `delegation`, `memory`, `routines`, `webhooks`), set only with
  `webhooks.setCapabilities` (no bot tool); a run gets exactly those on top, read at each call and run.
- **Granting any group except `web` and `webhooks` gives whoever can reach the address full access** (#12 review,
  finding 7): `shell` and `computers` directly (the engine token, the profile's keys, the leader is a computer);
  `coding` (a T3 Code task is a full-access coding agent on the leader when `LILBOT_T3_ENABLED=1`; inactive when off); `delegation` (the receiver's hidden session
  has full access and the run writes the task); `routines` (routine runs have full access and the run writes the task);
  `bots` (a new bot's first prompt runs with full access, and `lilbot_bot_edit` rewrites any bot's instructions);
  `memory` (shared facts every bot reads on every turn). `webhooks` stays narrow but adds addresses and runs; `web`
  lets outside data lead the run to fetch a URL carrying what it read.
- Reads: whatever its groups, a run never reads another bot's work items or any goal (`lilbot_work_list` with `mine:
  false`, `goals`, `goalId` or another bot's `itemId` is refused; `readsBeyondOwn` in `system/run-access.ts`).
  `lilbot_about` (the other bots, computers, deploy, the change log, and T3 when enabled) needs `bots` and `lilbot_status` needs
  `computers` (or `coding` when `LILBOT_T3_ENABLED=1`): a run needs none of it, and a refusal from the one tested list cannot drift the way a
  trimmed answer could. Skills stay readable (`skills_list`, `skill_view`): Hermes adds the skills plug-in back, and
  `lilbot-work` tells the run how to use the board. The folder read covers `attachments/`, `exchanges/` and `groups/`
  too. The bot's note (its system prompt, with the names of the computers) is the same in every session.
- Work (`work/webhook-items.ts`): a run opens at most three items and reports only on those; it names no check level
  and links no goal, so its items get their kind's level, and an item a bot would check (level 2) is checked by Oscar
  instead: a checker repeats the owner's commands and opens its links, which the run wrote. Every bot reads the text of
  a webhook run's items (title, done, question, result, drop reason, evidence) fenced as `<webhook-work-item>`, wherever
  it appears in `lilbot_work` and `lilbot_work_list` answers (lists, an item in full, its children, a goal's items). An
  item of a webhook run never resumes the run's session (`work-answers.ts`): Oscar's answer or send-back goes to the
  bot's main conversation with the item fenced as `<webhook-work-item>`; a drop ends a running turn and tells no
  session; a failed bot check (an older item) tells none.
- **Decided by the session, never by time** (#12 review, finding 1): a webhook run's session, and every session the
  engine continued it in, stays narrow for as long as it exists, whether the run is under way, settled or the engine
  works on its transcript later (Hermes' background review forks share the session's id). Two layers, both chosen from
  one list:
  - `webhook-access.ts` starts the run's session with only `lilbot_system` plus each group's engine toolsets (web:
    `web`; shell: `terminal`, `code_execution`, `file`; coding: `lilbot_t3` when `LILBOT_T3_ENABLED=1`; memory:
    `memory`; computers, bots, delegation, routines and webhooks live on `lilbot_system`). Hermes freezes a session's
    toolsets. Naming one MCP server leaves the others out. Hermes' `file` toolset
    is read and write together and has no per-session write root, so a narrow run reads with `lilbot_workspace_read`
    instead. Without `memory` the engine's memory tools and `search_conversations` are gone too. `lilbot_give_file` is
    in `shell` (a run can only give a file it could write); `lilbot_goal` is refused to every run.
  - LilBot refuses at the call what a run's session may not do (`webhooks/webhook-callers.ts`), because Hermes adds the
    skills plug-in back to any session and LilBot's own server lists every tool (`tools/list` has no
    session). A call that names its session is looked up: the memory adapter's, and the skills adapter's,
    which send Hermes' `session_id` (`x-lilbot-session`). An MCP call is matched to exactly one tool start, its own
    (`CallingChats.take`: the oldest one with its arguments or request id that no other call took, waiting up to 5
    seconds), so a run's identical call cannot get Oscar's refused, nor pass on his start. A call that cannot be placed
    (no start seen, no session named, an unreadable lineage) counts as a webhook run's: it fails closed. A bot that
    never had a webhook run is never held. Every `lilbot_*` tool is in `RUN_TOOLS` or a group (`system/run-access.ts`,
    tested). The T3 bridge refuses its tools without `coding`; the engine API retires `/engine/computers/*` (410) and
    refuses `skill_manage` always (the skills handler's own `/write` test) and the routes only older adapters call
    (`bots/create`, `routines/*`, `threads/*`) without their groups; memory reads and writes and `give_file` need
    `memory` (the memory block comes back empty).
  - A refusal is an ordinary tool result (`{"refused": ...}`), not a tool error: Hermes pauses a whole MCP server for
    about a minute after three tool errors in a row, keyed by the profile's connection, which could reach the bot's
    other conversations.
  - Other sessions: a webhook run never makes Oscar's calls wait a fixed time. For a bot that has had webhook runs, a
    main-conversation call outside the narrow set waits only until its own start is reported (usually already there)
    and is refused, retryably, only when none is seen in 5 seconds, as `lilbot_work`'s own matching already does
    (#174). Measured: 1 to 5 ms with the chat open in a browser, 0.75 to 1 s without (the activity observer polls every
    second), for good once a bot has had a webhook run. A sub-agent's calls of those tools report no start of their own
    and are refused after 5 seconds. An MCP server entry of its own for webhook sessions would remove the matching, but
    Hermes gives every enabled server to every normal session and cannot enable one for some sessions only
    (`_merge_mcp_servers`), so it would change every normal session.

## Run messages, production tools and APIs

- The run's message (`webhook-messages.ts`, `lilbot_webhook_message`, matched to its run by `requestId`): once per run
  and at most five per webhook a day, at most 4,000 characters, checked like an event (both scans), saved on the run.
  It never starts a turn: it is shown as a `webhook message` line in the bot's main conversation (the bot turns unread;
  state `shown`), and the bot gets it only with Oscar's next message there, as model-only text after the origin line
  (`TurnNotes`, state `read`): a LilBot notice and the message fenced as `<webhook-run-message>`. One message of his
  carries only the newest three, each cut to 1,000 characters, and the count of the rest (taken too, left to the
  Webhooks list), so waiting messages never push his send past what the engine takes (Hermes refuses `api_text` over
  1,000,000 characters; 300 waiting 4,000-character messages did before). Both memory paths drop these fences before a
  review sees the turn (`withoutWebhookNotes`: the after-chat queue and the save before compressing).
- Not gated: Hermes' background skill review of the bot's main conversation, after a turn that carried a webhook
  message or Oscar's answer to a webhook item (fenced). Its skill write names the main session, as the bot's own
  `skill_manage` does, so LilBot cannot tell which turn it reviews; turning the review off for bots with webhooks
  (`skills.creation_nudge_interval: 0`) would change Oscar's chats, which is his call. The text reaches it fenced and
  only after Oscar acted.
- Production tool set (read from `~/.hermes` files, 2026-11-21; updated when `lilbot-computers-v1` retired): the one
  configured profile (`default`) enables only the `lilbot-skills-v1` plug-in that LilBot adds to every bot, so a narrow
  run gets the same plug-in tools as on dev (`check:webhooks` prints them); its `revenuecat` and `paper` MCP servers are
  left out by the session's toolsets.
- Bot tools (LilBot's MCP server, the caller's own webhooks only): `lilbot_webhook` (`action`: `create` with request-id
  idempotency, at most five webhooks a bot, whoever asked, since `createdBy` is the bot's word; `pause`, `resume`,
  `delete`, `new_address`), `lilbot_webhooks_list` (each run's result fenced as outside data: a model wrote it after
  reading the events), and from a run `lilbot_webhook_message`. Nothing is in the Hermes plug-ins.
- Browser methods: `webhooks.list` (newest 50 runs with their event counts and messages; each webhook's
  `capabilities`), `pause`, `resume`, `delete`, `openRun` (a tracked chat snapshot), `address` (Copy),
  `setCapabilities`, push `webhooks.changed`.
