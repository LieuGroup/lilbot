---
name: lilbot-coding
description: Use for coding work (changing code in a repository, fixing a bug, building a feature, a refactor, tests, a pull request). How to decide between editing yourself, starting a worker, or delegating to a developer bot; how to write a complete brief; working copies, verification, work-board evidence, and memory.
---

# Coding in LilBot

Coding happens natively inside LilBot; this skill wins over any older instruction naming T3 as the way to code. Running a command, reading a file, or checking status is ordinary work: do that yourself. If you are already running as a worker, do the assigned task yourself and skip sections 1–3 (workers cannot start workers, delegate, or use leader-only tools).

## 1. Choose who does the work

1. **Do it yourself** for small, self-contained edits or quick fixes (doing two small things directly is fine) — unless your current model is restricted to thinking only, in which case plan the work and hand even a small edit to a worker on an allowed coding model (or a developer bot).
2. **Delegate to a developer bot** when a bot exists whose name and function cover developing that project. Always check `lilbot_bots_list` first (the system note lists only a few bots); read a candidate's instructions with `lilbot_bot_read` if its function is unclear. If a developer bot exists and is not you, hand the task to it with `lilbot_delegate` (`to`).
3. **Start your own worker** when you are the developer bot for the project or no dedicated developer bot exists, and the task is larger, multi-file, long enough to fill the conversation, or should run in parallel. Call `lilbot_delegate` with `worker: true` (and explicit `model` and `reasoningEffort`). A worker runs in a fresh hidden session with your instructions, skills, and memory, opens a `code` work item automatically, and cannot spawn workers or delegations. Answers arrive as new turns — tell Oscar you started it and carry on; never poll.

## 2. Models and reasoning effort

Follow Oscar's written rules (`~/code/home/AGENTS.md` and any rules he gave you) to pick the model and reasoning effort for the task. If your current model is thinking-only, plan and hand even a small edit to a worker on an allowed coding model (or a developer bot). Check available models with `lilbot_models_list` and pass `model` and `reasoningEffort` explicitly when launching a worker. Never guess or hard-code model names.

## 3. Write a complete brief

A worker or developer bot starts with no memory of this chat. Every coding brief must include:

- **Goal and why**: what needs to change and why it matters.
- **What "done" means**: the concrete, observable outcome.
- **Out of scope**: what not to touch or change, plus production safety rules and whether to commit, push, or open a PR.
- **Repository path and branch or PR**: exact repo path and base branch or existing branch/PR.
- **Verification**: the checks to run before finishing (tests, lint, typecheck, build, or live checks).
- **Oscar's decisions and words**: every decision he already made, quoting his own wording for constraints and preferences so nothing is lost.

## 4. Working copies, repo rules, and safety

- Read and follow the repository's own `AGENTS.md` (and `CLAUDE.md`, if present) before editing.
- Use a separate working copy (`git worktree`) for parallel work in the same repository or whenever changing a checkout that Oscar or another agent is using. Whoever creates a working copy removes it once the work is merged or abandoned.
- Never force-push, rewrite shared history, or skip hooks without Oscar's explicit OK.
- Never print, log, or commit secrets, keys, or tokens.
- For LilBot itself, also follow `lilbot_guide` topic `changing-lilbot` (branch and pull request, `bun run verify`, never test on production or live bots, production changes only via `bun run deploy` when Oscar asks).

## 5. Other computers

Workers can run on the leader or on any added computer that advertises a coding agent. Follow the machine roles in `~/code/home/AGENTS.md` (when present). From a main or delegated session (not inside a worker), check `lilbot_status` (area `computers`) to see which added computers are online and can host a coding worker, start one there with `lilbot_delegate` (`worker: true`, `computer`, `cwd`; no `files`, see `lilbot_guide` topic `threads`), and keep the Computers tools (`lilbot_guide` topic `computers`) for one-off commands or computers without a coding agent; if a required computer is offline, say so and stop.

## 6. Questions, progress, evidence, and memory

- **Real questions go to Oscar**: if a worker or delegated bot hits an ambiguity, missing access, or a decision only Oscar can make, do not guess. Update its `code` work item (`lilbot_work`) to `needs_oscar` with one clear question and choices; his answer arrives as a new turn.
- **Persist progress as you go**: a worker writes findings and progress to files, commits, or its work item as it goes, and resumes from those if the engine shortens its conversation rather than re-reading everything.
- **Work item and evidence**: workers get a `code` work item automatically (named in the worker prompt). When you code directly (not inside a worker), open a `code` work item (`lilbot_work`, `kind: "code"`) before editing so Oscar's board shows it. Before marking it `done`, record real evidence on it: the branch name, the pull request link (when opened), and the verification command output (`command` and `output`, plus `url` for a PR).
- **Lasting repo facts**: worker transcripts are not automatically reviewed for memory. If you uncover a lasting technical fact about a repository (a build quirk, required flag, or undocumented convention), save it directly with `lilbot_memory_save` (or `update_memory` on the leader) or document it in the repo's `AGENTS.md`. Leave task outcomes for the main conversation.
