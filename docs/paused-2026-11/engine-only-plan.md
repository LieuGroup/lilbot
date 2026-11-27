# Hermes as engine only: the seven-step plan, in brief

Back to [the pause record](../paused-2026-11.md). The owner's goal: a Hermes profile should be only an anonymous
runtime slot LilBot drives, not a bot Hermes's own apps list with LilBot's description, instructions and chats.

## Today

Each bot is a full Hermes profile with an opaque id as its name, except the main bot, which is Hermes's own `default`
profile. LilBot writes the bot's function into the profile description and its instructions plus the system note into
`SOUL.md`. New profiles are cloned from `default`, so they inherit its skills folder, `MEMORY.md`/`USER.md`, and MCP
servers. The main chat is a visible `gui` session, so Hermes's apps show it, with a Hermes-made title, and can
continue it.

The minimum Hermes must hold for a bot: one profile (opaque name), model setting and key, `approvals.mode: off`,
LilBot's three plug-ins (prompt, memory save, skills guard), LilBot's MCP servers, and the session store.

## The steps (each off by default behind its own setting, each reversible)

1. **LilBot ignores conversations it did not start.** PR 325. This is the step that actually protects the owner.
2. **Switch on LilBot's own prompt** (`LILBOT_PROMPT_OWNERSHIP`, built; wording in PR 321). Steps 3 and 6 rely on it.
3. **Nameless profiles:** empty description, one neutral soul line (not empty: a fallback with an empty soul answers
   as Hermes's stock agent), Hermes session titles off (`auxiliary.title_generation.enabled: false`).
4. **Hidden main chats:** create main sessions hidden, mark existing ones hidden, and make LilBot's importer accept its
   own sessions by id whether hidden or not. Recommended first after step 1: it removes what the owner actually saw.
5. **Clean new slots:** new profiles not cloned from `default` (`profiles.create` without `clone_from`, `no_skills`);
   a one-off clean-up of copied notes, soul and skills from existing profiles, backed up first. Inherited MCP servers
   are removed only where the owner says so.
6. **Move Chief of Staff off `default`:** one-off, with a dry run on a database copy, at a quiet time and with the
   owner told beforehand. The owner sees one "New session" line; LilBot keeps the old binding so moving back is one
   command.
7. **Optional, the owner's call:** hide LilBot's profiles in Hermes's desktop app and narrow Hermes's built-in tools
   per bot ([engine-own-tools.md](engine-own-tools.md)).

## What Hermes cannot do

- A bot cannot run outside a profile, and every profile appears in Hermes's profile list.
- Hermes stores every conversation it runs; LilBot can hide sessions, not keep them out.
- No lock stops Hermes's own apps from opening a chat on a LilBot profile. The firm control is step 1.
- The `default` profile cannot be deleted or parked.

The shared-profile alternative ([shared-profile.md](shared-profile.md)) could replace steps 3, 5 and 6 if its dev
spike passes; it is not proven.
