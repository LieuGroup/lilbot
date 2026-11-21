# Routines

`server/routines/` owns routines, schedules and run history, keyed by LilBot bot id. LilBot dispatches through
`BotEngine.runRoutine` and never creates, changes or removes Hermes cron jobs; existing external jobs stay independent.
The short version is in `AGENTS.md` under "Routines"; screen specs and behaviour are in [screens.md](screens.md).

## Schedules, bot tools and limits

- A schedule is an interval in seconds, daily at HH:MM, or weekly on a local weekday at HH:MM. Calendar schedules
  default to `Australia/Adelaide` and store an IANA zone. DST gaps skip that day's missing time; repeated times run at
  their first occurrence only.
- Bot tools (LilBot's MCP server, the caller's own routines only): `lilbot_routine` (`action`: create, pause, resume,
  delete) and `lilbot_routines_list` (the latest five runs of each routine, results cut to 500 characters). Two tools,
  not five: two listing lines a turn instead of five (#113). The plug-in's `create_routine`, `list_routines`,
  `pause_routine`, `resume_routine` and `delete_routine` ended with adapter 0.11.0; the engine API's `routines/*` stay
  only for sessions that loaded an older one.
- `createdBy: oscar` means the bot acts on an explicit request, `bot` its own initiative (attribution trusts the bot,
  not a security boundary). A bot may self-create at most five, paused included; a goal's review routine is LilBot's
  (see [goals.md](goals.md)) and not one of them. The minimum interval is five minutes for all. Repeating a create
  request id returns the original; deletion leaves a tombstone against resurrection.

## Scheduler, sessions and browser API

- The scheduler atomically creates a run and advances the next time before engine calls. After downtime it runs once
  for the oldest missed time and skips the rest. A routine never overlaps itself. Pause stops new occurrences (an
  admitted run may finish); resume starts at the next future time without replaying.
- Each run has its own hidden full-access session in the bot's folder and never touches the main conversation; results
  stay in Routines. Both session aliases are persisted before submission and excluded from the after-chat review, also
  after restart. Persisted run ids supply the session and submission request ids, so retries recover the same admission;
  transport failures retry after 30 seconds. If the engine says an outcome is unknown, show a failed run rather than risk
  repeating side effects. Runs emit activity and can mark the bot unread.
- Browser methods: `routines.list` (newest 50 runs; all stay in the database), `pause`, `resume`, `delete`, `openRun`
  (a tracked chat snapshot, main chat preserved), push `routines.changed`.
- A short-interval test override needs all of `LILBOT_DATA_DIR`, `LILBOT_BOT_IDS` and
  `LILBOT_ROUTINE_TEST_INTERVAL_SECONDS`; never on the live server.
