# Why handed-over work cost so much (research, not built)

Back to [the pause record](../paused-2026-11.md). Source: a read of the repo, the public Hermes source and the
production LilBot database (read only), done 27 Nov. No code, branch or PR exists. The trigger: the owner's Engineer
bot ran handed-over work all night at high cost.

## (a) Context size per reply

- **Cause:** each bot-to-bot exchange reuses one receiver engine session for every request (the first `thread_chats`
  row). Replies sat at 230k–470k tokens of context. One reply re-read 62.8M cached tokens over 351 tool steps, about
  179k per step.
- **Planned fix:** each new request in an exchange gets a fresh engine session with a short hand-over (the brief plus
  the last answer). Redirects and answers stay in the running session. The change sits in
  `server/threads/thread-runner.ts` and `thread-store.ts` and needs no Hermes knowledge.

## (b) #328: an approval nobody could see

- **Cause:** Hermes publishes `approval.request` and `clarify.request` on the run's own socket. Full-access turns have
  no handler for them; only limited sessions deny. Hermes's `AGENTS.md`-write gate (`file_tools_write_guards.py`)
  ignores `approvals.mode: off` and waits 300 s per prompt; calls that queue behind one prompt wait until interrupted,
  which is how a turn sat for 2 h 31 min.
- **Planned fix:** in `runRoutine` (`server/engines/hermes/hermes-routines.ts`) answer every approval with
  `approval.respond` deny and every clarify with an empty `clarify.respond`, so the turn carries on and the bot hears
  why. Hard stops that stay: protected instruction files, hardline commands, `approvals.deny` globs, `sudo -S`.

## (c) #329: stop did not stop

- **Cause:** `stopRun` only sends `session.interrupt`. Background-process completions are admitted as new turns
  unless the session was closed by its viewer.
- **Planned fix:** on cancel, call `process.stop` (kills the processes the session owns), then `session.detach` with
  an `end_reason`. The session then counts as closed by the user, so later notices become notes, not turns. Lives in
  `server/engines/hermes/hermes-run-control.ts`.

## (d) Missing usage records

- **Cause:** in production, 15 of Engineer's 32 replies carried only context numbers, no tokens. `runRoutine` calls
  `usage.seedInfo` on a resumed session but never `session.stats`, which `hermes-chat.ts` does. So a reply only got
  token deltas when Hermes had just reloaded the session.
- **Planned fix:** seed from `session.stats` on resume, as `openChat` does. This one gap should recover most of the
  missing cost.

## Order when resuming

1. (d) then (b) in `hermes-routines.ts`, unit tests, one commit each.
2. (c) in `hermes-run-control.ts`.
3. (a) in `server/threads/`.
4. A cancel-with-background-process live check, built on PR 321's allow-list guard.

Overlaps: no other branch touches #328 or #329. PR 325 touches `bots/hidden-chats.ts` and history files only. The
duplicate-tools work ([engine-own-tools.md](engine-own-tools.md)) also edits `server/engines/hermes/` profile config.
