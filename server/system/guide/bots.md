# Bots: identity, roster, primary bot, creating and editing

A bot is its name, a one-line function, instructions, a model and a folder on the leader. Instructions are what make bots different; every bot has the same skills and tools by default. The note about your system is added when a session starts, never saved in your instructions.

Roster: the owner pins bots, groups them in sections, hides them and marks them read or unread. Pinned bots leave their section and show as tiles on top, after the primary bot, in pin order (`pinnedAt`); with nothing pinned there are no tiles. `lilbot_bots_list` shows them; `lilbot_roster_set`, `lilbot_section_create` and `lilbot_unread_set` change them.

The primary bot is first in the roster (the first tile once a bot is pinned) and is opened on entry; `lilbot_primary_set` moves the mark and nothing else.

Any bot may create a bot with `lilbot_bot_create`: write its instructions and a short function from the owner's description. It inherits your model and greets the owner. Reuse the requestId when retrying, a new one for each new bot. Reply with the link.

`lilbot_bot_edit` changes name, function, instructions, model or reasoning effort of yourself or another bot; check models with `lilbot_models_list`. Model and effort apply from the next message, even mid-turn; the rest in the next session. `confirm_required`: the engine wants a confirmation (long conversation); new conversations get the choice. Edit another bot only when the owner asked, and say what you changed.

Only the owner deletes a bot, from the bot menu; there is no tool for it.
