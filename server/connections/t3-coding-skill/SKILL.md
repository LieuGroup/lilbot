---
name: t3-coding
description: Use for any coding task (changing code in a repository, fixing a bug, building a feature, a refactor, tests, a pull request). Hand the work to T3 Code with the lilbot_t3 tools and follow it; do not edit repositories yourself.
---

# Coding through T3 Code

Coding work goes to T3 Code, the owner's coding backend. You start a T3 thread, follow it, and report
its result. You do not edit repositories, make worktrees or open pull requests yourself.

Running a command, reading a file or using an app is not coding: do those yourself as usual.

The tools are your `lilbot_t3` MCP tools (`t3_project_list`, `t3_thread_launch`, ...). LilBot
signs in to T3 Code for you. If the only tool is `t3_connection_status`, or a tool answers that
LilBot is not signed in, call or quote it, tell the owner exactly what it says, and stop.

## Before you launch

1. Read `~/code/home/AGENTS.md`. It decides which machine does the work, where repositories live
   (`~/code/<project>`), and which model and reasoning effort to use. Follow it; do not repeat it
   to the owner.
2. Find the project with `t3_project_list` (`t3_project_read` for details). Work for another
   machine goes to that machine's environment: `t3_environment_links` gives its `environmentId`.
   If the repository is not registered, follow the home rules: clone with `t3_project_clone`
   to `~/code/<project>` and register it with `t3_project_create`.
3. Check the model is offered with `orchestrator_capabilities` (use `search` for others).

## Launch once

Call `t3_thread_launch` with an explicit `projectId`, `title`, `modelSelection`,
`runtimeMode: "full-access"`, the task in `message`, and `workspaceStrategy` (a new worktree
for independent work, as the home rules say, unless the owner names another base or checkout).

Choose a new `clientRequestId` (for example a random UUID) for each new task and keep it. If the
launch fails or its answer is lost, retry with the same `clientRequestId`: T3 then returns the
same thread instead of starting a second one. Never launch a replacement because a wait or a
read failed: the thread keeps running.

Write the task as a complete brief: what to change, where, how to check it, and the repository's
own rules (its `AGENTS.md`). Say whether a pull request is wanted.

## Follow it

- Right after the launch, tell the owner the thread's `link` exactly as T3 returned it, as a
  Markdown link. Never build a link from an id, and never give a localhost link.
- Follow with `t3_thread_wait` (`threadId`, `timeoutMs` at most 600000). A timeout is normal:
  wait again or read with `t3_thread_read`. Use the explicit `threadId` in every call.
- If a wait or read loses its connection while LilBot restarts, the T3 task keeps running.
  Retry `t3_thread_wait` or `t3_thread_read` with the same `threadId` once the bridge is back.
  Do not report the task as failed just because the bridge disconnected. If a launch response
  was lost, retry that launch with its original `clientRequestId` to recover the thread.
- If the thread waits for an answer, read it and answer with `t3_thread_send`, or ask the owner.
  `t3_pending_request` shows a pending question or approval.
- To change course, `t3_thread_send`. To stop, `t3_thread_interrupt` with `stop: true`.

## Report

When the thread finishes, report what it actually did (files changed, checks run and their
result, a pull request if one was made) and repeat the thread's `link`. Report a failure as a
failure, with what the thread said.

## Deploying LilBot

For LilBot itself, follow its AGENTS.md deployment procedure. Commit and verify in a clean
development checkout, then use only `bun run deploy` to restart it. Never run a direct service restart.
If the connection drops during deployment, the independent watchdog owns recovery. On your
resumed turn read `bun run deploy --status` from that checkout and report its outcome to the owner.
Do not retry a deploy while the lock remains or remove a recovery lock automatically. A rollback
switches the production release symlink and restores a database up to a minute old; do not replay side effects.
