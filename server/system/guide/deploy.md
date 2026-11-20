# Deploy: how a new LilBot reaches production

Production runs only from an immutable release built from a commit. Only `bun run deploy`, run in a clean checkout after `bun run verify` on that exact commit, builds a release and restarts the service. A watchdog checks health for 60 seconds and rolls back, restoring the database, on failure. `lilbot_status` (area deploy) and `lilbot_about` show the running release, the latest deployment and the last failure.

Never edit release folders, restart production as a check or edit the database by hand.
