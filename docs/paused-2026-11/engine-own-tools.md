# Hermes's own duplicate tools, and its tool-name repair (research, not built)

Back to [the pause record](../paused-2026-11.md). Nothing was switched off on any profile. Removing a tool from the
owner's bots is his decision.

## What the live checks showed (test bots, under the guard, nothing ran)

- A GPT model created a weekday routine with Hermes's `cronjob_manage` instead of `lilbot_routine`. Such a routine
  never shows in LilBot's Activity tab and is not deleted with the bot.
- An Inkling model ran `hermes curator …` in the terminal (on a real bot that is the production engine) and
  `find / -name …` across the whole disk.
- Two models used `execute_code` for a multiplication.

## Toolsets that duplicate what LilBot owns

| Hermes toolset | LilBot's own | Off per profile by configuration? |
|---|---|---|
| `cronjob` | `lilbot_routine` | yes |
| `delegation` | `lilbot_delegate`, `lilbot_group` | yes |
| `session_search` | `lilbot_history_search` | yes |
| `connections` | `lilbot_connection` | yes |
| `computer_use` | `lilbot_computer_*` | yes |
| `memory` | `lilbot_memory_*` | already off for connected bots |
| `skills` | `lilbot_skill_read`, `lilbot_skill_manage` | no: LilBot's skills plug-in rides on it |
| `todo` | partly the work board | yes |

The `terminal` toolset can still run `hermes …` (including `hermes cron create`); no configuration stops only that
command.

## The design (checked against Hermes's source; tried on a scratch home)

- Write `agent.disabled_toolsets` with `cronjob`, `delegation`, `session_search`, `connections` and `computer_use`
  added, merged with what is already there (an existing `browser` entry stays). It is subtracted last and per tool, and
  the gateway applies it to chat, `tool_search`, `tool_call` and delegate children.
- Turn off the profile's own MCP servers that are not `lilbot_*` with `mcp_servers.<name>.enabled: false`; the config
  entries stay. Undo with `hermes config unset mcp_servers.<name>.enabled`.
- Apply it in `prepareRuntime` through `applied()`, so a hand edit is repaired on the next start, then `reload.mcp` so
  open chats drop the tools without a Hermes restart. One setting switches it back.
- **Build:** add `server/engines/hermes/hermes-own-tools.ts`, call it from `HermesEngine.prepareRuntime` behind a
  setting, add `config.set`, `reload.mcp` and `agent.disabled_toolsets` to the contract test, then four dev proofs.

## Hermes silently repairs tool names

Before running a model's tool calls, Hermes repairs any name the session does not offer
(`agent/turn_tool_validation.py` calling `repair_tool_call` in `agent/agent_runtime_helpers.py`): it lowercases,
turns `-` and spaces into `_`, splits CamelCase, strips a `tool` suffix up to twice, and failing that takes the closest
offered name (`difflib.get_close_matches`, cutoff 0.7). It writes the repaired name back and runs that tool; the only
record is a diagnostic log line.

Run offline against a session's tool list, with Hermes's source unchanged:

| The model writes | Hermes runs |
|---|---|
| `lilbot_execute_code` | `execute_code` |
| `lilbot_cronjob_manage` | `cronjob_manage` (Hermes's scheduler) |
| `lilbot_delegate_task` | `delegate_task` (Hermes's subagent) |
| `mcp__lilbot_system__lilbot_execute_code` | `mcp__lilbot_system__lilbot_guide` (a different LilBot tool) |
| `mcp__lilbot_system__mcp__lilbot_system__lilbot_work` | `mcp__lilbot_system__lilbot_work` (intended) |
| `lilbot_work` (no prefix) | refused as unknown |

33 of Hermes's own tools were reachable this way. There is no setting to turn the repair off, and the tool-execution
middleware sees only the repaired name. What configuration can do is shrink the targets: a switched-off toolset is no
longer in the session's list, so a repair cannot land on it (from the source; not proven live). Stopping the repair
needs a Hermes change, which this repo's rules forbid; it could be raised with Hermes's makers. In LilBot's own live
checks it is closed: PR 321's guard allows only exact offered names.
