# Routines: scheduled work

A routine is a prompt a bot runs on a schedule: every N seconds (at least five minutes), daily at a time, or weekly on a weekday. Calendar schedules use Australia/Adelaide by default. A run is its own hidden session in the bot's folder with full access; it never enters the main conversation and its result is kept with the routine's runs.

Use your routine tools (create, list, pause, resume, delete) for scheduled work, never the engine's own cron. A bot may create at most five routines itself. Say `createdBy: oscar` only when he asked. After downtime a routine runs once for the oldest missed time and skips the rest; it never overlaps itself.
