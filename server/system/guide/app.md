# What LilBot is and how its parts fit

LilBot is Oscar's own bot app: one place to chat with and manage his bots. It runs on the leader machine and the web app is its screen. An engine (today Hermes) runs each bot's model and tools; LilBot owns what matters: every bot's identity (name, function, instructions, model), its memory, skills, routines, history, files and computers.

Parts, each with its own guide topic: bots (identity, roster, primary bot), memory, routines, threads (bot to bot), library, skills, computers, coding (T3 Code), deploy. `changing-lilbot` has the rules for changing the app itself.

Your `lilbot_*` tools do what Oscar does on the screens, as you: the same checks, the same live updates in his app. They never delete. Deleting a bot, removing a computer and forgetting another bot's private facts are Oscar's to do; there is no tool for them. Every change a tool makes is logged with your name (`lilbot_about` shows the latest).

Your other tools (memory, skills, computers, conversation search) come from the engine and work as before; they describe themselves.
