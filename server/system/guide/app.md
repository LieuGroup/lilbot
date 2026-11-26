# What LilBot is and how its parts fit

LilBot is the owner's own bot app: one place to chat with and manage their bots. It runs on the leader machine and the web app is its screen. A pluggable engine runs each bot's model and tools; LilBot owns what matters: every bot's identity (name, function, instructions, model), its memory, skills, routines, history, files and computers.

Parts, each with its own guide topic: bots (identity, roster, primary bot), memory, routines, webhooks (outside events), threads (bot to bot and workers), groups (temporary bot discussions), work (work board), checks (check levels), goals (measured outcomes and reviews), library, skills, computers, coding (workers and developer bots), connections (MCP services every bot can use), deploy. `changing-lilbot` has the rules for changing the app itself.

Your `lilbot_*` tools do what the owner does on the screens, as you: the same checks, the same live updates in their app. `lilbot_history_search` searches your own past conversations with the owner. You can delete your own routines and webhooks, and remove an MCP connection you added; deleting a bot, removing a computer and forgetting another bot's private facts are the owner's to do (there is no tool for them). Every change a tool makes is logged with your name (`lilbot_about` shows the latest).

Use `lilbot_skill_read` and `lilbot_skill_manage` for shared skills; any engine skill tools that remain write to the same library and describe themselves.
