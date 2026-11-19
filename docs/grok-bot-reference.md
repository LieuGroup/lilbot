# What Grok Bot does (reference, not a spec)

Studied from the app's code (1.0.1) and screenshots (1.1.0). Reports: `~/agent-tmp/grokbot-findings.md`,
`~/agent-tmp/grokbot-ui-ref/`, and Oscar's `~/code/Grokbot-cli/docs/`. Copy structure and behaviour, never its
artwork, names or text.

- Layout: bot roster left (main bot pinned on top, named sections, latest-message preview, unread dot), one ongoing
  conversation in the middle, a details panel on the right (Activity: routines, suggestions, computer, voice;
  Library: pages, media and files, newest first, tabs only when there is more than one kind).
- Bot menu: pin, move to section, mark unread, rename, copy conversation id, hide, delete. The main bot instead has
  unpin and "replace with a different bot", which only changes which bot is the main one.
- Create bot: name, avatar cover shape, cover colour and face colour, nothing else. A one-time id makes a retry safe.
  A typed first message replaces the bot's automatic introduction.
- Status line: mostly built by the app from the tool in use ("Searching the web", "Running commands"), plus a status
  text the bot can set itself. A finished or failed turn shows for 8 seconds, then idle.
- Memory shape: a profile text, dated journal entries, and facts with a learned-at time.
- What Oscar's two test bots said about themselves (their own account unless marked observed; report in
  `~/agent-tmp/grokbot-live-research/FINDINGS.md`):
  - Workspace: every bot works in the same shared folder (`/workspace`) on one 128 GB machine, and one bot can list
    another's folder. Each bot also has a small private folder (profile, settings, attachments, assets, a store).
    Skills live in one shared folder. LilBot's folder per bot is a deliberate difference.
  - Memory: four kinds, `profile` (lasting facts about the user and how to work with them), `journal` (dated history,
    latest entries shown), and a shared version of each that every bot of the user sees, tagged with the bot that
    learned it. Profile facts go into every turn; older ones are fetched by a recall tool (query, limit, kind).
    Writes are `write` or `forget` of one fact; a correction is forget then write.
  - Long conversations: the full transcript is kept (observed: 458 rows, all still readable, no reset), while the
    model sees a structured summary of older turns followed by the recent ones, and can search old turns with a
    tool. The trigger and limits are unknown.
  - Live state (observed): running, thinking, a tool activity with a short detail text, composing, then a settled
    result. The status text comes from a status tool the bots themselves say they do not have.
- Still unknown: compaction thresholds, background memory tidy-up, where memory is stored.
