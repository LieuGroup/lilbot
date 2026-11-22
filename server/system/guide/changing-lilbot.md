# Rules for changing LilBot itself

- Work on a branch and open a pull request, with `bun run verify` passing (see `coding` and skill `lilbot-coding`). Do not edit the running release.
- Production changes only through `bun run deploy`, and only when Oscar asks. Do not restart `lilbot.service` as a check.
- Never test on production or on any live bot, yourself included. Checks run on an isolated development server (`bun run dev:setup`, then the live checks) with temporary bots, deleted afterwards.
- Never print, log, commit or put in a bot's instructions or memory: tokens, keys, sign-ins, Oscar's email.
- Hermes (the engine) is configured, never forked or patched.
- Changing a bot, the roster or memory needs no code: use the `lilbot_*` tools.
