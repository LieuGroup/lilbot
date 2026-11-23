# Deploy: internals, installation and manual recovery

The deploy rules (only `bun run deploy` restarts production, how rollback works, what is never replaced) are in
`AGENTS.md` under "Deploy". This file holds the detail behind them.

## How a release is built

`~/code/LilBot` and T3 worktrees are development source only: editing or pulling there does not change production.
Nobody edits release folders.

Verification records the exact commit in the checkout's Git directory; a dirty checkout runs the checks but gets no
deploy marker. Deploy exports that commit with `git archive` (no working tree or untracked files), installs its
locked dependencies and builds its web app in a staging folder, then renames it to `~/lilbot/releases/<commit>`. A
release manifest supplies its running commit without Git metadata. Existing release folders are reused, never edited.

Deploy freezes its watchdog under `<data>/deploy/runner/` and starts the independent `lilbot-deploy.service`. It
checks that the unit points at the configured release symlink, that the health endpoint belongs to that unit, and that
its data directory matches. An atomic `<data>/deploy/lock/` excludes concurrent deploys, even if the caller
disconnects.

## Copies and status files

- Database copies are in `<data>/deploy/backups/<id>/` (`lilbot.db` and `version.json`), made with SQLite's online
  backup API (never raw-copy `lilbot.db`, `-wal` and `-shm` independently), which folds committed `-wal` pages into a
  self-contained copy using the live database's locking/`-shm` state. Restore happens with the unit stopped and removes
  stale WAL/SHM files. Up to a minute of data may be lost (accepted). The data directory is never replaced: keys,
  `engine-token`, `t3-grant.json`, other secrets, workspaces and engine sessions stay in place. Back up
  `computer-server-key.pem` securely alongside the database copies.
- The last three release folders and three database copies are kept; the active release is never pruned.
- `<data>/deploy/job.json` records the current outcome; `history/<id>.json` keeps outcomes and masked journal lines;
  `notice.json` holds the last failure. `bun run deploy --status` tells the deploying bot the result on its resumed
  turn. The last failure is a notice the app fetches on reconnect and every bot's next memory context includes; no agent
  loop, developer bot or notification system for it. A healthy deploy does not erase failure history; a person may
  remove `notice.json` after acknowledging it.
- Migrations and new plug-in versions ship with a normal deploy; existing data imports after it.
- **Helper rollout and rollback order:** deploy the server first; build, publish, or upgrade helpers after. Existing
  older helpers stay compatible with a newer server, but a newer helper cannot register or stay connected against an
  older server that does not recognise its reported fields. Rolling the server back past a change to what helpers
  report needs helpers built from the same older code.

## Overrides

`LILBOT_DATA_DIR`, `LILBOT_DEPLOY_UNIT`, `LILBOT_DEPLOY_WATCHDOG_UNIT`, `LILBOT_DEPLOY_HEALTH_URL` (loopback HTTP),
`LILBOT_RELEASES_DIR` and `LILBOT_RELEASE_LINK`. Defaults match production. Another installation needs a matching
watchdog `ExecStart` pointing to its data directory's runner and job file.

## Installing on a machine (done on the leader)

1. In the source checkout, run `bun install --frozen-lockfile` and `bun run verify`.
2. Add `~/.config/systemd/user/lilbot.service.d/release.conf`:
   ```ini
   [Service]
   WorkingDirectory=%h/lilbot/release
   ExecStart=
   ExecStart=%h/.bun/bin/bun %h/lilbot/release/server/main.ts
   ```
   Keep `environment.conf` (`LILBOT_ENV=production`), `public-door.conf`, `access.conf`, all other unit settings,
   data directories and ports unchanged.
3. `install -m 644 systemd/lilbot-deploy.service ~/.config/systemd/user/lilbot-deploy.service`, then
   `systemctl --user daemon-reload`. Do not enable the watchdog; deploy starts it on demand.
4. Run `bun run deploy --bootstrap` once. It requires that no release symlink exists, builds the first release, backs
   up the database, switches the symlink and restarts through the watchdog. Data, keys, workspaces and skills stay
   where they are. With no earlier release, a failure restores the database, stops the service and keeps the lock for
   manual repair.

## Manual recovery

Inspect `job.json` and both units, keep the service stopped, repair the cause, select the recorded release and
database copy, and preserve every key. Only after confirming health may a person remove `deploy/lock/` and resume
normal deployment. Nothing removes a stale lock automatically.

The watchdog's rollback clears `compression.checkpoint_required` (#148) itself before the previous release starts
(`server/deploy/rollback-profiles.ts`): a release from before memory adapter 0.13.0 cannot take the save, so a flag left
on would stop its bots from ever shortening a long conversation. It reads the bound, non-deleted bots from the restored
database and runs Hermes with the service unit's `HERMES_HOME`, `LILBOT_HERMES_BIN`, `LILBOT_ENV` and `PATH`; in
development only on `dev-` profiles under the development home, in production never on them. `job.logs` gets one line
with counts (`[rollback] memory save flag cleared for N bots`). If it says
some could not be checked or cleared, clear those by hand: `hermes -p <profile> config set
compression.checkpoint_required false` (the default bot: without `-p`). During the rollback itself a cached Hermes agent may
still run adapter 0.13.0 against the older server, which refuses its request: one turn may then stop with Hermes' own
text.

## `bun run check:deploy`

Uses its own clone, release root, symlink, data directory, free port and two temporary systemd units, with an
unmatched bot allowlist. Checks a healthy deploy, rollback at 60 seconds, restored WAL data, notices and failed
recovery. Creates no profiles; never touches production or any live bot.
