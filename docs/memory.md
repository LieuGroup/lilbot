# Memory and after-chat review

LilBot owns memory (`server/memory/`) so it survives an engine change, can be shared between bots, and can be seen and
corrected by Oscar. The short version is in `AGENTS.md` under "Memory"; Hermes adapter internals are in
[hermes-engine.md](hermes-engine.md).

## Store, rules and safety

- `server/memory/memory-store.ts`: the `memory_facts` table with full-text search. A fact has a kind (`profile` =
  lasting, `journal` = dated history), a scope (`bot` = only the bot that learned it, `shared` = all bots), an author
  (bot or user), dates, an optional expiry, `via` (chat, review, app, import) and the chat it came from. Forget marks
  a fact; it is never erased. A fact can be paused (kept, not shown to bots), forgotten and restored.
- `memory-service.ts`: the rules, engine-neutral and unit-tested: default scope (profile facts shared, journal entries
  private; either can be overridden), visibility, de-duplication, recall by search, and `contextBlock`, what a bot sees
  before each turn (lasting facts, then its last 10 journal entries, within about 1,500 tokens; the rest by recall).
  A write tells the bot when it holds more lasting facts than it is shown, so it tidies.
- The engine reads and writes memory through a plug-in (Hermes: Python, standard library only, holding no data) and
  the engine API: `recall_memory` and `update_memory` (write or forget one fact, optional `expires`). New bots use
  LilBot memory from their first session; an existing bot is connected from its Memory panel, from its next session.
- Saving rules (in the plug-in's instructions): save only what is grounded in the conversation, never infer traits, a
  one-off request is not a standing preference, one fact goes in once, and never save secrets, what can be looked up,
  task progress or "tool X is broken". `memory-safety.ts` refuses facts carrying model instructions, secrets or
  invisible characters (zero-width, bidi controls, the byte-order mark, stray tag characters), from bots and from the
  user. Soft hyphens, the England, Scotland and Wales flags (the only tag sequences allowed; other tag characters are
  hidden ASCII) and other format characters stay ordinary text there and in bot-to-bot messages; only webhook payloads
  refuse every format character but the soft hyphen. Every rule scans in linear time.
- Plug-in versions: the current one is in `memory-adapter/plugin.yaml`. To ship a change, bump `version` there and
  `VERSION` in `__init__.py`: each version installs into its own folder and loads on the bot's next session; start-up
  reinstalls older adapters only for bound, non-deleted profiles. LilBot warns when a bot still calls with an older
  adapter.
- Design sources: `~/agent-tmp/memory-study/` (Hermes, OpenMausBot, nightly-labs OpenBot, CopilotKit OpenBot).
- Not built yet: the nightly tidy-up (merge duplicates, drop outdated facts), attaching facts relevant to the user's
  message automatically, and holding a turn's writes until the turn succeeds.

## The after-chat review

A bot saves what it notices during a chat; LilBot's review catches what it missed (Hermes' own review does not run for
connected bots).

- Finished turns of real conversations (not routine or webhook runs, bot threads, their compression children or
  sub-agents) queue in `review-queue.ts` until reviewed; the save before compressing skips the same sessions
  (`skipped`: Hermes' checkpoint completes without a review).
- `memory-reviewer.ts` reviews a bot once 10 turns wait, or once 3 wait and the chat has been quiet for 2 minutes.
  `LILBOT_REVIEW=off`, `LILBOT_REVIEW_TURNS` and `LILBOT_REVIEW_QUIET_SECONDS` change that. Each tick drops queued
  turns of unknown or deleted bots (also below the threshold or with reviews off); owned bots with missing runtimes
  keep theirs. If the engine reports a missing bot its turns are discarded once; other failures retry after 10 minutes.
- LilBot runs no model: `BotEngine.reviewMemory` runs a hidden session of the same bot with only its memory tools
  (about 4,500 prompt tokens instead of 26,000), on `LILBOT_REVIEW_MODEL` (`provider::model`; otherwise the bot's own
  model, which costs more). Its own session is never queued for review. The same setting picks the model of a same-bot
  work check (see [work.md](work.md)).
- A review may not bring back a fact the user removed and may not forget a fact the user wrote. What it saves is marked
  `via: review`. No approval step (Oscar's decision): facts apply at once, and the Memory panel shows where each came
  from and lets him pause, forget and restore.
- `check:memory` reads the bot's real system prompt for the rules; asking a bot to describe its own instructions is
  unreliable.
