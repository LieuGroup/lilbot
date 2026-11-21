# Skills

`server/skills/` owns a shared standard `SKILL.md` library at `~/lilbot/skills` (`LILBOT_SKILLS_DIR`), with authorship
and per-bot off switches in SQLite. The short version is in `AGENTS.md` under "Skills"; screen specs and web behaviour
are in [screens.md](screens.md).

## Shared library and per-bot switches

- All skills default on; Setup shows the same states.
- Chat, routine runs and memory reviews prepare the same catalogue and switches. Switches control offered skills, not
  filesystem access for full-access bots. Tool changes apply at once; prompt catalogues refresh next session.
- New and edited skill text refuses secrets and hidden characters; instructions in a skill are allowed. Authorship
  comes from the bot's capability.
- The three skill tools stay on the Hermes skills plug-in, not on the MCP server (#113, third slice): Hermes' own
  `skill_manage` cannot be dropped without a patch, and without the override it would write into the library with no
  check and no author. Evidence and the way back: [hermes-engine.md](hermes-engine.md#skills-plug-in-skills-adapter).
- Import copies user skill folders from bound, non-deleted profiles once per source path, never moving or deleting
  profile files. Identical copies coalesce; different contents get a stable hash-suffixed name. Imported text is not
  retroactively filtered. Native engine skills stay with the engine; changing one through the app tool first creates
  an app-owned copy.
- Removing duplicate profile skill folders is a future, separate change made after checking import results and backups.

## Engine skills switch (#140)

- One "Include this engine's skills" switch per engine, global for all bots (`engine_skills`); per-bot differences stay
  with the per-skill switch. It covers the skills imported from that engine's profiles (origin kept in `skill_origins`,
  set when an import writes the skill, so a bot's later edit does not move it) and the skills the engine offers by
  itself.
- Off: excluded, so no bot is offered them; nothing is deleted and no per-bot switch is touched, so switching on
  restores them exactly. Hermes hides its bundled skills through the profile's `skills.disabled`, except
  `hermes-agent`, which Hermes refuses to disable: `BotEngine.alwaysOnSkills` reports it with the reason.
- Defaults: an engine that already has bots when the migration runs is on (Oscar's Hermes, so nothing changes); an
  engine added later, or a new LilBot, is off, and start-up imports nothing from it until it is switched on. Turning a
  switch applies it to every bound, non-deleted bot in the background (the start-up flight, with its retries).
- `skills.list` gives each skill's `origin` (LilBot, an engine, a bot, Oscar) and `excluded`; `enabled` stays the bot's
  own switch. `skills.engines` lists engines with their state, counts and always-on skills; `skills.setEngine` sets it,
  with the `skills.changed` push. Oscar's setting: no bot tool. Screen: `needs-ui` (Paper "19 Plugged in" frame 4 waits
  for Oscar).
