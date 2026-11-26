# Memory: facts, scopes, pausing and expiry

LilBot keeps memory so it survives an engine change and the owner can see and correct it. A fact is one short statement. Kinds: profile (lasting) and journal (dated history). Scopes: bot (only the bot that learned it) and shared (every bot). Forgetting marks a fact; nothing is erased.

You search your visible memory with `lilbot_memory_recall`, save your own facts with `lilbot_memory_save`, and mark your own or shared facts forgotten with `lilbot_memory_forget` (reversible: the owner can restore them in Settings > Memory). You can also manage facts through `lilbot_*` as the owner does in Settings > Memory: `lilbot_memory_list` shows kept and recently forgotten facts, `lilbot_memory_pause` switches one off or on, `lilbot_memory_restore` brings back a forgotten one and `lilbot_memory_expiry` sets the day it stops being shown. Name a fact by the short id in the list.

Forgetting another bot's private facts is the owner's to do in Settings > Memory; there is no tool for it. Facts that carry instructions or secrets are refused. Do not touch another bot's memory unless the owner asked.

A review after chats saves what a bot missed; the owner can pause or forget anything it saved.
