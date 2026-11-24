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
- Bots read and manage shared skills through LilBot's System MCP server (`lilbot_skill_read` and `lilbot_skill_manage`), calling the same `SkillsService` and `BotSkills` methods as the Skills screen. `lilbot_skill_manage` and `/engine/skills/write` share `SkillsService.writeForBot`: bots can create and update ordinary shared and profile-imported skills (recording who last changed them and logging to `system_changes` without the skill body), while LilBot's built-in skills (`lilbot-*`, `lilbot_*`, `t3-coding`) and all registered engines' always-on/bundled skills are protected through both doors. `lilbot_skill_manage` also lets a bot toggle its own per-bot switch on ordinary shared skills; built-in skills, engine skills, another bot's switches, and the per-engine "Include this engine's skills" switch stay owner-managed.
- While the Hermes `lilbot-skills-v1` plug-in remains installed, Hermes's overridden `skills_list`/`skill_view`/`skill_manage` tools coexist beside `lilbot_skill_read`/`lilbot_skill_manage` and both write to the same `SkillsService` library. Retiring the Hermes plug-in later requires Hermes to allow disabling its native `skill_manage` (or redirecting `skills.create_dir` safely) without dropping `skill_view` for bundled skills like `hermes-agent` ([hermes-engine.md](hermes-engine.md#skills-plug-in-skills-adapter)).
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
