# Bots as sessions on one shared Hermes profile (research, not built)

Back to [the pause record](../paused-2026-11.md). Today every LilBot bot is its own Hermes profile. The owner asked
whether a bot could instead be just a set of sessions on one LilBot-owned, nameless runtime profile, the way a
terminal user types `hermes`. References are to Hermes v0.23.1 (commit `3b421578`, the installed version) and its
wire contract. Nothing was built and no model was called.

## What a session can carry (proven on the dev gateway, no model calls)

- Model, provider and reasoning effort: `session.create` takes them.
- Working folder: `cwd` with `cwd_explicit`.
- LilBot's MCP server with a per-bot key: only on `source: 'acp'` sessions, through `editor.mcp_servers` (URL plus an
  `Authorization` header for that session only). The shared profile must have no profile-level `lilbot_system` server
  and must use `no_mcp`. The server must be supplied again on resume. A `gui` session with an editor policy is refused.
- Hidden sessions: absent from the default lists, present only with `include_hidden`.
- Many bots at once: 12 sessions created together without failure; no Hermes session cap is set by default. Many turns
  *running* at once was not tested.

## Source findings (Hermes 0.23.1, file:line)

1. **Prompt per session: yes.** `session.create` takes `client_env` (`tui_gateway/contracts/canonical_sessions.py:64`),
   and `HERMES_EPHEMERAL_SYSTEM_PROMPT` is an allowed key (`agent/session_client_env.py:23`). It is stored with the
   session's frozen policy (`gateway/session_policy.py:479-498`), bound around each turn (`session_policy.py:1150`),
   read as the ephemeral prompt (`gateway/run_config_loaders.py:93-101`) and added when the request is sent
   (`agent/turn_context.py:1530`). It is keyed by the logical session, so it survives compaction
   (`hermes_state_local_lineage.py`). **It is appended to Hermes's own prompt, not a replacement**, so the
   `lilbot-prompt-v1` swap is still needed to drop Hermes's text. It is frozen at creation and not re-checked on an
   exact retry. The alternative (our plug-in choosing by `session_id`, `agent/turn_api_request.py:158`) breaks at
   compaction, which gives a new child id (`agent/conversation_compression.py:1609,3287`).
2. **Memory save per session: yes, through LilBot's adapter.** The provider receives `session_id` and, after
   compaction, `on_session_switch` gives the new one (`agent/agent_init_memory_provider.py:105-145`). Needs one shared
   save key plus a session-to-bot lookup on LilBot's side (`server/http/engine-api.ts`, keyed per bot today).
3. **Skills:** the `skills` launch parameter only preloads (`gateway/session_policy.py:745-770`). Turning skills off per
   session means explicit `toolsets` without `skills` (`session_policy.py:657-695`) and serving skills only through
   `lilbot_skill_read`.
4. **Model, effort, folder, toolsets, MCP:** confirmed. A per-session MCP server is accepted only from `source: 'acp'`
   (`gateway/session_local_editor.py:17`) and must be re-supplied on resume (`gateway/session_local_mcp.py:282`). ACP
   edits ask by default and "sensitive paths" always ask (`acp_adapter/edit_approval.py:144-160`).
5. **Hidden sessions:** the roster preview and default lists skip them (`hermes_state_sessions.py:1339`,
   `tui_gateway/methods_profiles.py:199`). A list that asks for hidden sessions shows every bot's sessions together.
6. **Still per profile:** `state.db`, the memory provider choice, `approvals.mode`, `plugins.enabled`, skills folders,
   the model key, and `compression.checkpoint_required`. If any of these breaks, every bot stops at once.

## What gets worse

- Bots share one conversation store; Hermes's `session_search` searches the whole profile, so it must be off
  (LilBot's bot-scoped `lilbot_history_search` exists).
- One bad setting, plug-in failure or damaged `state.db` stops every bot.
- Main chats must become ACP sessions, which changes their toolset and edit-approval defaults.
- A conversation cannot move between profiles: each bot starts a fresh session (LilBot's own record stays). Undo is
  pointing the bot back at its old profile, so old profiles are kept until the owner confirms.
- The per-bot key is not a hard boundary against a full-access bot in either design: the key material sits in files
  the bot's own user can read.

## Remaining questions

- Does an ACP hidden main chat compact, save memory before compaction, and import into LilBot's history exactly as a
  `gui` chat does today? This is the largest unknown.
- Does a session created with `client_env.HERMES_EPHEMERAL_SYSTEM_PROMPT` keep that prompt after a real compaction?
- Can many turns run at once on one profile?

## Next step

Write the design from these findings, then one dev spike: a single temporary bot whose main chat is a hidden ACP
session on a shared profile, run through `check:prompt-behaviour` and a real compaction with the memory save. If it
passes, it replaces steps 3, 5 and 6 of [the engine-only plan](engine-only-plan.md); step 4 is still needed.
