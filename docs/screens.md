# Screens

Visual specs and client behaviour for the built web screens. Core UI stack rules (shadcn/ui, AI Elements, colours, font,
type scale, bundle budget) are in `AGENTS.md` under "Stack" and "Web app".

## Layout (`app/router.tsx`)

- Wide screen: roster 272px and details panel 332px on the page tint (`bg-background`), the conversation on
  `bg-card`; a `hairline` divides them.
- Roster (`bots/bot-sidebar.tsx`, Paper "16 Roster: pinned tiles and collapsed rail"): app icon, then collapse
  (wide screens only), search and new bot; "Working together" while a group runs; the tiles (or the primary's row);
  sections as 12px labels; collapsed "Unassigned" and "Hidden" groups with counts. Grouping is `bots/roster-groups.ts`.
- Working together (`threads/working-together.tsx`, Paper "18 Bots working together" frame 6, a lazy chunk loaded only
  once a bot in `bots.list` has `groups`): a section labelled like the others, at the very top, hidden while searching.
  One 52px row per running group: a 36px tile of the first four bots' avatars 2 by 2 (15px, gap 2, padding 2, radius
  10, `foreground/6`), the purpose (14/20 500, one line) and "Round N · N bots" (13/18 muted) with the blue spinner.
  The row opens the group in its leader's conversation; the open one has the pressed tint. The bots and the leader come
  from each bot's `groups` (`runningGroups` in `threads/group-lines.ts`), so the row goes when the group disbands and the
  section with the last one.
- Tiles (`bots/roster-tiles.tsx`, Paper frames 5 to 7): only once a bot is pinned; with nothing pinned the primary is an
  ordinary first row with its star and state line. Tiles share the roster's width equally, at most three to a line
  (two tiles half each, three or more a third each; a shorter last line keeps that width). Radius 12, gap 4, padding
  10 top, 8 bottom, 6 at the sides (4 with three to a line), a 52px avatar at the top and the name under it (12/15,
  weight 500, centred, up to two lines, then an ellipsis); tiles in a line are as tall as the tallest. Primary first
  with a star badge at the avatar's bottom right (on the muted tint when the tile is open), then pinned bots oldest pin
  first. Unread: a 600 name and a 12px blue dot at the avatar's top right. Working: a small blue spinner badge in place
  of the star. Open: the pressed tint (`foreground/6`). No status line: the title gives the name and the row's
  one-line state. A 20px "more" button appears at the top right on hover.
- Rail (`bots/roster-rail.tsx`): 64px. The app icon, then 36px avatars in 48px slots (radius 12) in the roster's
  order, with a 28px hairline between groups; open groups only. Same dot, spinner, star and open tint, scaled down.
  While a group runs, a slot per group with the same 36px tile goes above the bots, then a hairline; its label is the
  purpose and "Round N · N bots" (same lazy chunk as "Working together").
  Pointing at an avatar shows a dark label (`ui/tooltip.tsx`) with the name (13/18, 500) and the state (12/16, 70%).
  Foot: open roster, search (opens the roster with the search box focused), new bot, settings, the user (or a red
  dot while offline). The deployment failure notice shows only in the open roster.
- Row (52px), one line from `bots/row-state.ts`: working (blue spinner and the activity text, "For <bot> · <activity>"
  while it works on a task another bot handed it, from `workingFor` on `bots.list`; "In a group · <activity>" or
  "Leading a group · <activity>" while it works and is in a running group, the activity being the bot's own turn in that
  group, from `groups[].activity`, else its general one), "Waiting for you", finished (green check),
  failed (red cross), or, idle, "Leading a group" / "In a group" (no mark) while it is in a running group, else the
  bot's function (no message preview in the data yet). A handed-over task wins over a group (that is the turn running
  now); waiting for Oscar and an unavailable runtime win over both. The drawing's "· 2 tasks out" has no data and is
  not shown.
  Unread rows have a 600 name and a blue dot; on hover the "more" button replaces the dot.
- Footer: the user, a Settings button and, while the socket is down, "Offline · reconnecting" with a red dot (the
  composer then says "Reconnecting...").
- Chat header, one 52px line: name, function, new session and the details toggle.
- Conversation column max 680px: bot text without a bubble (15/24), the user's message in a tinted bubble, tool lines
  13px, a round composer in two rows: the text, then a plus button for files, the model pill and an ink send/stop
  button (stop while the bot works and the box is empty with no files).

## Model picker (`bots/model-pill.tsx`, `bots/model-menu.tsx`, Paper "14 Model picker")

- Pill: 28px, fully rounded, "model · Effort" at 13/18 500 muted with a 13px chevron (the model alone when it does not
  reason); hover and open tint it (`foreground/6`). Saving: a 12px spinner before the new values. Sent level differs from
  the chosen one: a 13px info circle after the effort. Saved model no longer offered: "Choose a model" in red. A bot
  without its own model reads "Default model". A refused change shows a red-outlined note above the text; a switch the
  open conversation could not take shows a hairline-outlined note with an info icon.
- Menu: 280px card, radius 8, opens upward from the pill. "Find a model" box, then provider names (12px muted) over
  30px model rows; the current one has a tick before it, weight 500 and a tint, the others line up after the tick.
  Then "Reasoning effort" with the current level muted and a chevron (two lines when it reads "<chosen>, sent as
  <sent>"), hidden for a model that does not reason. A last muted line: "Changes <bot>'s model and effort, from the next
  message."
- Effort submenu: 196px, to the right (over the menu on a phone): Default, Off ("if the model allows" when the engine
  does not say; hidden when it cannot be disabled), a divider, Minimal, Low, Medium, High, Extra high, Max, with the
  same tick rows. Setup's "Reasoning effort" field opens the same list.

## Bot menu (`bots/bot-menu.tsx`, Paper "02 Bot menu")

One shared menu (208px, 30px rows) anchored at the "more" button or the cursor; `bots/bot-menu-target.ts` holds which
bot and which dialog. Items: Pin/Unpin, Move to section (sections with the current one checked, "No section", then
"New section…", which names a section and moves the bot into it), Mark as read/unread, Name and avatar, Make primary,
Hide/Show, then Delete…. A failed action shows a short red note above the roster footer.

## Delete confirmation (`bots/delete-bot-dialog.tsx`, Paper "03 Delete bot")

"Delete <name>?", what goes (the conversation and its routines, counted from `routines.list`) and what stays, then
Files (Archive / Delete) and Private memories (Forget / Keep, with the bot's private fact count). Server errors show
in the dialog. Sentences are `bots/delete-copy.ts`.

## Settings (`settings/settings-dialog.tsx`, Paper "04 Settings")

720×480 dialog with General, Bots, Memory and Computers on the left. Bots: "When a bot is deleted", the same two
choices as the delete dialog, saved at once with `bots.deleteDefaults.set`. General and Memory are placeholders.

## Computers (`web/src/computers/`, Paper "12 Computers" and "15 Devices and main computer", lazy page of Settings)

- Title row: "Computers" and the ink "Add this computer" button, which opens the dialog below.
- This device (`web/src/devices/this-device-card.tsx`, the same block on a phone): the label "This device", then a
  two-row card. Name: a 220px field (200px below `sm`), prefilled once from system and browser ("Mac · Chrome",
  `device-name.ts`), saved with `devices.rename` on Enter or leaving the field (an empty name goes back). Runs on: a
  select of every computer, a separator and a muted "Not one of these" (`devices.linkComputer`). Under the card one 12px
  muted line from `Device.resolves` (`device-line.ts`): tied, main, no main, or "<computer> is offline. Bots will ask
  before using another computer." (offline wins). It reads `devices.current` again on `devices.changed`,
  `computers.changed` and every reconnect.
- The label "Computers", then one card (`bg-background`, 12 radius, hairline dividers), one row per machine, the leader first: 8px dot (`success`
  online, `foreground/20` offline, `destructive` key conflict), name 13/500, a 12px line (`computer-rows.ts`: "Linux ·
  where LilBot runs · online", "macOS · offline · last seen 2 hours ago", the red key-conflict sentence; the row this
  device runs on adds "· this device runs on it"). The main computer has a "★ Main" tag after its name. Two fixed slots
  keep the actions in columns: "Make main" (84px, not on the main computer, `computers.setMain`) and Remove (60px, not
  on the leader), which asks "Remove <name>?" first. The list reads `computers.list` again on every
  `computers.changed`; the page's 30-second tick keeps "last seen" counting.
- Under the card: "Every bot can use every computer here. The main computer is the one bots use when you write from a
  phone, or from a device that is not one of these." At the bottom, the link "Add a machine without a screen…".
- Add this computer (`add-computer-dialog.tsx`, 400px, lazy; the steps are `add-step-*.tsx`, the flow is
  `use-add-attempt.ts`, the screen for each state is `add-phase.ts`). Step 1: Name (prefilled "Mac" or "Linux
  computer", the browser cannot know the host name) and Download, with "For Apple silicon Macs" style build line;
  nothing is minted before Download. Step 2: "Open the installer" names the downloaded file, a spinner row with the time
  left, "Download again". The page tries the loopback hand-over (`helper-handover.ts`) and polls status. Step 3: green
  check, "<name> is connected", "This browser is tied to it, so "my computer" written from here means this Mac" (the
  start call carries the device id, so the server ties them), and the switch "Make it my main computer · Used when you
  write from your phone" (`use-main-choice.ts`): on when no computer was main, which makes the new one main at once so
  closing keeps it; off when one was; turning it off gives the mark back to the previous main, or none. Done. After about 30 s without a helper it shows "Still waiting for the helper" with the
  short code and Copy, the time left, Download again, and "Open LilBot Helper" when the build answers
  `lilbot-helper://` links (the link, which holds the code, is never rendered). After 10 minutes: "This attempt ran
  out" with Start again. On a system that is not macOS or Linux (the page decides at open, nothing minted) or when the
  server says `supported: false`: "This device can't be added" (or "Not ready yet" for `unavailable`, not in the
  prototype) and "Add by command line instead", which opens the dialog below. The code appears only in the
  not-detected state and the command-line dialog; it is dropped once the helper registers or the attempt ends.
- Add by command line (`command-line-dialog.tsx`, 432px): a name field and "Create command"; the code is minted only
  then (`computers.installCode`), shown inside `printf '%s' '<code>' | ./lilbot-helper install <helper door>`
  (`install-command.ts`) with Copy and "Valid for m:ss more". When it runs out the page drops the code and says so. The
  code is never logged, stored or kept after the dialog closes.

## Details panel (`bots/bot-details-panel.tsx`)

Avatar, name and pill tabs. Activity shows the live state (with how long, only when this browser saw it start:
`activity/activity-since.ts`), "With other bots" (below), "Routines" and "Webhooks" (below) and the workspace folder (click copies
the path; a browser cannot open a server folder).

## Skills (Paper "17 Skills and webhooks" frames 1 to 3, `web/src/skills/`)

- Section (`skills-section.tsx`, frame 1), in the Setup tab between Workspace and Abilities: a 12px "Skills" label with
  "14 · 2 off" at the right ("14" with none off, "1 of 14" while searching), a "Find a skill" box (32px, 10 radius,
  hairline, 14px search icon; filters names and descriptions), then one hairline card with a row per skill
  (`skill-row.tsx`: padding 10/12, gap 12, `foreground/6` lines): the name (13/18 500), the description on one line
  (12/16 muted, cut) and the ink switch. A switched-off row has a muted name and reads "Off for <bot>". A refused switch
  puts it back and shows a 12px red line under the card: "Could not switch <skill> off. Try again." Under the card, 12px
  muted: "All bots share these skills. A switch here only affects <bot>, from its next session. Ask a bot in chat to
  write or improve one." Nothing found (frame 3): no card, 13/20 muted "No skill matches “<text>”. Ask a bot to write
  one."
- One skill (`skill-detail.tsx`, frame 2, `?skill=`), in place of the Setup tab's content: "‹ Skills" (13/18 500), the
  name (16/22 600) and the full description (13/20 muted) with the same switch, a facts card (Written by, Last changed
  "Today 14:24", "For <bot>": On/Off), the files as 12px monospace pill tabs (SKILL.md first, the selected one on
  `foreground/6`, wrapping on a phone), the selected file in a hairline card (`skill-file-text.tsx`: markdown headings
  14/600 and 13/600, body 13/20; other files as 12px monospace text), and "Read-only here. Ask a bot to change it."

## Routines (Paper "07 Routines", `web/src/routines/`)

- Card (`routines-card.tsx`, panel 1): a 12px "Routines" label with the count, then one hairline card. Row (padding
  10/12, gap 12, `foreground/6` lines between rows): the task on one line (13/18 500, truncated; 70% ink when paused),
  a 12/16 line and the ink switch. Lines: "Every day at 09:00 · next tomorrow" (the time only for interval schedules),
  "Running now · every 30 min" with the blue spinner, "Last run failed · next today 18:00" in red, "Paused · Mondays at
  08:00". A calendar schedule in another zone than the device's adds "<city> time". Under the card, 12px muted: "Ask
  <bot> in the chat to add or change one." With none, only "Ask <bot> in the chat to add one, for example “check the
  reviews every morning”."
- One routine (`routine-detail.tsx`, panel 2), in place of the whole panel: a 52px bar with "‹ Routines" (13/18 500)
  and the bin (28px icon button; none for a goal's routine). Then the full task (14/21 500) with the switch, a facts card
  (Schedule, Next run or "Paused", Created: "You asked for it", "The bot set it up" or "For your goal"), for a goal's
  routine a 12px note with the goal's words, and "Runs" (`run-list.tsx`): status mark in a 14×18 slot (green check,
  red cross, grey square stopped, blue spinner running or starting), the due time (13/18 500), the result on up to two
  lines (12/16, red with "Failed: " when failed) and a chevron. Five runs, then "Show older runs" (12/16 500) adds ten.
- Delete (`delete-routine-dialog.tsx`): 432px, "Delete this routine?", the task quoted (120 characters at most), "no
  longer runs, and it leaves this list with its runs. A run already under way finishes. This cannot be undone.",
  Cancel and a red "Delete routine". Back to the list after.
- A run (`run-view.tsx`, panel 3), in the conversation column: a 52px header with the 16px clock, "Routine run" (14/20
  600) and "Today 09:00 · 48 s" (13/18 muted; "· running" while it runs), and "Back to chat". Then, 744px wide at most,
  a `bg-background` block "The routine asked" (12/16 muted) with the task (14/21), the tool lines (4px apart) and the
  bot's text, the shimmering activity line while it runs. Foot, 12/16 muted and centred: "A finished run is read-only.
  To follow up, go back to the chat." (while it runs: "The run is still working. It is read-only: to follow up, go back
  to the chat."). No composer.

## Webhooks (Paper "17 Skills and webhooks" frames 4 to 6, `web/src/webhooks/`)

- Section (`webhooks-card.tsx`, frame 4), under Routines, only while the bot has webhooks: a 12px "Webhooks" label with
  the count, then one hairline card. Row (padding 10/12, gap 12, `foreground/6` lines): the task on one line (13/18 500,
  truncated; muted when paused), a 12/16 line and the ink switch. Lines: "GitHub · last event 2 hours ago" ("just now",
  "5 min ago", "1 hour ago", "on Thu 19 Nov" after a day), "Paused · GitHub · no events yet", and, like a routine's,
  "Running now · GitHub" with the blue spinner while a run waits or runs, "Last run failed · GitHub · last event ..." in
  red. Under the card, 12px muted: "Ask <bot> in the chat to watch something."
- One webhook (`webhook-detail.tsx`, frame 5), in place of the whole panel: the routine's 52px bar with "‹ Activity" and
  the bin; the full task (14/21 500) with the switch; a facts card: From (the service), Last event ("Today 14:12" or "No
  events yet"), Created ("You asked for it" or "<bot> made it") and Address with an outlined "Copy" (12/16 500, padding
  4/10, radius 8, `foreground/12` ring; the row's padding 7/8/7/12). The address itself is never drawn. Then "Runs" as a
  routine's (`run-list.tsx`): "Today 14:12 · 3 events" (the run's first event; "1 event"), the result on two lines, red
  with "Failed: " when failed, a chevron. Under it, 12px muted: "Events that arrive close together are handled in one run.
  The address is a secret: anyone who has it can wake this bot."
- Delete (`delete-webhook-dialog.tsx`, frame 6): the routine dialog's shell (`routines/confirm-delete-dialog.tsx`, 432px,
  padding 24, gap 20, where the frame draws 332/20/16, so both delete dialogs stay alike):
  "Delete this webhook?", "Its address stops working at once, and its past runs are removed. <service> will keep calling it
  until the bot or you remove it there.", Cancel and a red "Delete". Back to the Activity tab after.
- A run (`webhook-run-view.tsx`), in the conversation column like a routine run (`routines/run-transcript.tsx`): the 16px
  webhook mark, "Webhook run" and "Today 14:12 · 3 events", "Back to chat", then "The webhook asked" with the task, the
  tool lines and the bot's text, and the same read-only foot.

## Library (Paper "08 Library", `web/src/library/`)

- Tab (`library-tab.tsx`, panel 1): filter pills All / Media / Files (12/16 500, 4/10 padding, 6 apart; the chosen one
  ink with background text, the others a `foreground/12` ring). Then one section per group: a 12px muted label (Today,
  This week, Older) and a hairline card, `foreground/6` lines between rows. Empty: "Nothing here yet. When <bot> hands
  you a file, it appears here." (another filter: "Nothing of this kind yet.").
- Row (`library-row.tsx`, padding 8/10, gap 10): a 36px tile (radius 8): the image itself, else a 16px icon (file,
  page, sound, video) on `bg-background`; the title (13/18 500, one line) and "Image · 412 KB · 09:14" (12/16 muted;
  "Mon" this week, "2 Nov" before; a file's kind is its extension in capitals, "CSV"). A downloadable file shows a 28px
  download mark on hover or keyboard focus (always on touch screens). Missing: an outlined tile with a crossed file,
  the title at 50% ink, "File no longer in the workspace", not clickable.
- "Show more" (12/16 500 muted) under the last group while more remain. At the bottom of the tab, a hairline card "Browse
  the whole workspace" with a 15px folder and a chevron.
- Workspace (`workspace-view.tsx`, panel 2), in place of the whole panel: a 52px bar with "‹ Library", the path line
  (13/18: "Workspace / raw / 2026", earlier parts muted and clickable, `foreground/40` slashes, the last 500), then one card
  of folders (15px folder, chevron, opens it) and files (15px file, size 12px muted), padding 9/12. Under it, 12/16 muted:
  "2 folders, 4 files. Working files stay here; only what the bot hands over appears in the Library."
- Viewer (`library-viewer.tsx`, panel 3, lazy): 560px wide and up to 760px high (880 by 900 on large screens), radius 16.
  A 56px header: the title (14/20 600) and "Image · 412 KB · today 09:14" (12/16 muted), an outlined Download button
  (13/18 500, 14px icon) and close. The preview on `bg-background`: the image fitted with 24px around, or a page on a
  hairline sheet (Markdown in `prose-chat`, HTML in a sandboxed frame). Footer (12/20 padding, 13/18): "Given in the chat,
  today 09:14" or "Given by a routine run, ..." muted, and "Show in chat" (500).

## Work between bots (Paper "09 Bot threads", "18 Bots working together" frames 1 to 9, `web/src/threads/`)

One pattern for asking (#65), handing over (#135) and temporary groups (#136). Wording is `threads/thread-lines.ts`
and, for groups, `threads/group-lines.ts` (pure, tested; LilBot's own words, never the server's text for an end that was
not a close), data `threads/thread-store.ts` (`threads.list` per bot on screen, read again
half a second after `threads.changed`). Bot and file names are plain text everywhere.

- Line in a conversation (`threads/thread-line.tsx`, a lazy chunk): a bordered row (radius 10, `hairline` ring), padding
  9/10/9/12, gap 10: the other bot's avatar (20px), a 13/18 500 title, a 12/16 state line with a 12px spinner or check,
  "Stop" while it runs (12/16 500, radius 6, `foreground/12` ring), a 14px chevron at 40%. The whole row opens it.
  - Asked: "Asked <bot>" / "<bot> asked this bot"; "<bot> is working on it", "Answered · N messages", "Could not be
    delivered" (red), "Stopped at the N-message limit".
  - Handed over (it has a `batchId`): "<bot> · <task>" / "From <bot> · <task>" (task: the request's first line, cut);
    "Waiting to start", "<activity> · <run time> · N files sent", "Redirected · picks it up at its next step" (while a
    redirect waits for the receiver's next step: `redirecting` on the view), "Finished · <run time> · N files back", "Failed · <reason>"
    (red; the server's short fixed `failure`, else "Failed · <bot> could not be reached" for older failures), "Stopped by you · after <run time>", "Stopped by <bot>" (stopped: muted title).
    The receiver's line says "N files received, N sent back".
  - Tasks of one call share one card: a header "Handed out N tasks" / "M of N finished" (12px muted, padding 8/12),
    then the rows divided by `foreground/6`. The card is drawn at the batch's first line; the others' rows are empty
    and hidden (`empty:hidden`), so they take no gap.
  - A group (`threads/group-line.tsx`, in the same chunk): every bot's avatar overlapping (20px, 5px overlap, at most
    five, each on a card-coloured plate), "Group · <purpose>" in the leader's conversation and "In <leader>'s group ·
    <purpose>" in a member's; "Round N · X of Y have replied" with the spinner while it runs ("Starting" before the first
    round), "Closed · N rounds, N turns, <time> · outcome inside", "Stopped by you · round N", "Ended by itself ·
    reached the N-round limit" / "reached the message limit" / "reached the time limit" / "went quiet" / "its leader
    could not be reached" (ended other than closed: muted title). Stop while it runs, in every participant's line. It
    stays in the conversation and opens the group long after it disbanded.
- Stop (`threads/stop-thread-dialog.tsx`, lazy): "Stop this task?" (16/22 600), "<bot> stops working on it now.
  <delegating bot> is told you stopped it, and what was said so far stays readable. Work a bot already did is not
  undone." (13/20 muted), "Keep going" and "Stop task" (red). 400px, padding 20, radius 16. Calls `threads.cancel`.
  A group: "Stop this group?", "All four bots stop working on it now. <leader> is told you stopped it, ..." (the
  number of bots, leader included, in words up to five), "Stop group".
- Opened (`threads/thread-view.tsx`, lazy): over the conversation column (`?thread=<id>` on `/bots/$botId`); the
  conversation stays mounted, `invisible` and inert, so its socket and scroll position are kept.
  - Header 52px, hairline under it: a task's title (14/20 600) with "<A> handed this to <B>" (12/16 muted), or "<A>
    and <B>" for an asked thread; "Stop" (13/18 500, red text, `destructive/40` ring) while a task runs, and "Back to
    chat" (`foreground/12` ring), which drops `thread` and keeps the tab.
  - Status strip (tasks only), on the page tint with a hairline under it: the state with its mark ("Working ·
    <activity> · <time>", "Finished · <time>", ...) and "N files passed" at the right (12px).
  - Messages, max 744px, gap 18, padding 16/24/20: a centred "Today 10:02 · started from <A>'s chat"; each message has
    an 18px avatar, the name (13/18 600) and time (12px muted), a "Redirect" or "Your answer" tag (12/16 500,
    `foreground/6` pill), then its tool lines and text indented 26px. Files as chips under the message (16px file icon,
    13/18 500 name, 12px size, radius 10, hairline ring) that download from
    `/api/threads/<bot>/<thread>/<message>/<n>`; a file not delivered says so and has no link. After a stop, a centred
    "Stopped by you · 10:09" between hairlines, and later answers at 60% with "· came after the stop, not delivered".
    While the receiver works: its avatar and name, then a spinner and its activity.
  - Footer, hairline above: "You watch this. To steer, talk to either bot." ("You read threads." for an asked thread)
    and a button to each bot's chat (a deleted bot's is disabled; its stored name still shows).
- A group, opened (`threads/group-view.tsx`, its own lazy chunk loaded from the thread view; Paper frames 5 and 7):
  - Header: the purpose (14/20 600) with "Temporary group · led by <leader>", after the end "Group closed today 10:21 ·
    led by <leader>" ("stopped", "ended"); "Stop group" (red outline) only while it runs, and "Back to chat".
  - Strip, only while it runs: one chip per bot (14px avatar, the first word of its name at 12/16, or the whole name
    when another bot in the group starts with the same word; the leader's at 500;
    pill on `bg-card` with a hairline ring; scrolls sideways on a phone) and "Round N of <roundCap>" at the right.
  - Discussion, gap 16: a centred divider between hairlines opens each round at its point, "Round N · to everyone ·
    10:10" or "to Footy and HeardBack" (the chips' names). Messages as in a task; the leader's carry "leader"
    in place of the time (its round's divider has it), "leader · 10:21" on a message outside a round. File chips download
    like an exchange's; so do the kept files in the outcome card.
  - While a round runs, under the discussion (indented 26px, gap 8): each bot the round is for, and the leader once it
    works on the replies: 16px avatar, "<bot> replied" with a green check, "<bot> · <activity>" with the spinner (from
    `group.members[].activity`), or "<bot> · Waiting to start".
  - Ended: a card on top (`bg-background`, radius 12, padding 14/16, gap 10): "Outcome" (12/16 600) and "N rounds · N
    turns · <time>" at the right, the outcome (15/24), then "Kept by the leader" and the kept files as chips. A stopped
    or self-ended group has "Stopped by you" / "Ended by itself" and the reason in its place ("You stopped this group
    in round 2, before the leader closed it.", "It reached the 3-round limit before the leader closed it."). The whole
    discussion follows.
  - Footer: "You watch groups. To steer, tell the leader in its chat." with a button to the leader's chat; after the
    end "This group has disbanded. It stays readable from the line in <leader>'s chat and from its Activity tab."
- "With other bots" in Activity (`threads/with-other-bots.tsx`): hidden when there are none; "N running" (else the
  count) at the right of its label; rows (avatar 20, 13/18 500 title, 12/16 line, chevron) "Asked <bot>", "<bot> asked
  this bot", "Handed to <bot>", "<bot> handed this bot work", with "Working · <task>" or "<date> · <task or ended
  state>", and groups: two other bots' avatars overlapping (16px), "Group · <purpose>", "Running · round N · N bots"
  or "<date> · closed with an outcome" / "stopped by you" / "ended by itself · <reason>". Avatars sit in a 26px lane.
  Running first (a group runs until it ends), then newest; a row opens the exchange or group (on a phone it closes
  the panel first).

## Conversation history (Paper "11 Conversation history", `web/src/history/`)

- Message origin (Paper "15 Devices and main computer"): a user message sent from another device has a 12px muted
  "from <device name>" under its bubble, right-aligned, plain text; messages from this device, and older ones with no
  origin, show nothing. A message from another device or tab appears live from its `user.message` event; when the
  engine started its turn first, it goes before that turn's reply (`ChatView.bareTurn`).

- Loading line: "Loading earlier messages" with a spinner, floating at the top. Measured movement of the visible row
  when a part arrives is under 1 px.
- Day lines: 12px, `foreground/50`, "Mon 9 Nov", with the year for another year.
- The very start: the bot's avatar (44px), its name and "Your conversation started on 3 September 2026".
- "Latest": a floating pill (arrow and "Latest") at the bottom centre while scrolled up.
- Session divider: a hairline with "New session" and its time ("Today 14:20", "Yesterday 09:05", "Tue 10 Nov 08:00").
  A session LilBot started because the engine could not resume the conversation adds "The previous session could not
  be resumed" under the time, in the same style. Only the newest has the line "<bot> starts fresh from here. It keeps
  its memory and can search what was said above."

## Attachments (Paper "10 Attachments", `web/src/attachments/`)

- Drop area (`file-drop.tsx`): while files are dragged over the conversation column, a dashed "Drop to attach" area
  covers the message list with "Up to N files, X MB each".
- Before sending (`composer-attachments.tsx`, AI Elements' Prompt Input attachments pattern on `ui/attachment.tsx`,
  in a `block-start` addon): a row above the text. Images are 64px thumbnails from the local bytes, files are chips
  (icon, name, size), each with a round remove button on its corner. An uploading file shows a blue spinner and Send
  reads "Send (waiting for uploads)".
- Refused: a red-outlined row per refused file with the reason, and one red line for files over the per-message limit
  ("3 files were left out. A message takes up to 10."). "Too large: 48 MB. The limit is 20 MB." is worded from the
  file's size and `attachments.limits`; other refusals show the server's `reason.message`. Texts and rules are pure
  functions in `attachment-rules.ts`.
- In the conversation (`message-attachments.tsx`): images above the user's bubble as 120×150 tiles (radius 14, side
  by side, wrapping) that open the image viewer; files as chips that download through their server URL; then the
  text bubble (none when the text is empty).
- Image viewer (`ui/image-viewer.tsx`, lazy, props `{ image: { url, name }, onClose }`): the image large, its name,
  download and close. The Library has its own viewer (`library/library-viewer.tsx`) with the design's details line and
  footer.
- "Model cannot see images": a tinted note under the message with a "Change model" link to the Setup tab.

## Web app behaviour

Client routing, state, caching and interaction rules for the screens above.

### Shell, rail, menus, details panel, avatars and model picker

- Shell: on a wide screen three columns: roster, conversation, details panel. The roster search filters names and
  functions, hidden bots included. On top, tiles, only once a bot is pinned: the primary bot with a star, then pinned
  bots in pin order (`pinnedAt` from `bots.list`, the same on every device), sharing the width at most three to a line;
  a pinned bot leaves its section, and a hidden one stays in Hidden. With nothing pinned, the primary is an ordinary
  first row. Then the user's sections, then collapsed "Unassigned" and "Hidden" groups (with no sections, bots are
  listed plainly). The group holding the open bot stays open; open groups are remembered per browser. Grouping is
  `bots/roster-groups.ts`.
- Rail: on a wide screen the roster collapses to a 64px rail of avatars in the same order (closed groups left out),
  remembered per browser (`bots/roster-view.ts`); the rail is a lazy chunk. Phones never show it.
- Bot menu (`bots/bot-menu-rules.ts` decides the items): opened from a row's or tile's "more" button or a right-click
  on a row, tile or rail avatar. The primary bot's menu has only Mark as read/unread, Name and avatar and "Change
  primary bot" (a submenu of the other bots; only the mark moves): it is always the first tile, so pin, section and hide
  would change nothing, and it cannot be deleted. The engine's default bot has no Delete.
- Delete dialog: starts from `bots.deleteDefaults.get`, read on every open; "Change defaults" closes it and opens
  Settings on Bots; deleting the open bot returns to the app's start.
- Details panel: each tab is the route `/bots/$botId/$tab`; `/bots/$botId` is a layout route, so the chat column stays
  mounted and connected while tabs open, change and close. At 1280px and wider the panel opens on Activity by itself
  unless the user closed it (remembered per browser); opening another bot keeps the open tab. On a phone it opens
  only from the toggle and covers the chat. To add a tab: an entry in `DETAILS_TABS` (`bots/details-tabs.ts`) and a
  lazy entry in `tabContent`, whose component takes `{ botId }` and wraps its body in `ui/panel.tsx`.
- Avatars: ten vector cover shapes and twelve colours for cover and face. Shape and cover default from the bot's id;
  a missing face colour reads as ink without rewriting the row. Create and the bot menu's "Name and avatar"
  (`bots/edit-avatar-dialog.tsx`) use the same three picker rows.
- Model picker: a pill in the composer after the attach button shows "model · Effort", or the model alone for a model
  the engine says does not reason (`bots/model-pill.tsx`, writing to `bots/model-picker-target.ts`); it opens the Model
  Selector menu upward (`bots/model-menu.tsx`, a lazy chunk): "Find a model" (Base UI's menu filter), models grouped by provider with a tick on the current one
  (`ModelChoices`, shared with Setup's field), then a "Reasoning effort" row with a submenu (`bots/effort-choices.tsx`:
  Default, Off, Minimal to Max for every reasoning model; "Off" hidden when `canDisableReasoning` is false, marked "if
  the model allows" when null), and "Changes <bot>'s model and effort, from the next message." Choosing saves at once
  with `bots.update`, also while the bot works; the pill shows a spinner meanwhile, a refusal puts the saved value back
  with a red note in the composer. When the engine sends another level than the one chosen (`effectiveReasoningEffort`)
  the pill shows an info mark and the row reads "<chosen>, sent as <sent>"; never for Off against Default, which the
  engine reports alike (`bots/reasoning-effort.ts`). A switch the engine holds back (`confirm_required`) keeps the saved
  choice and shows a plain note: "This long conversation keeps its model until New session; new conversations use the
  new one." The saved model reads "Choose a model" in red only once `models.list` has loaded without it. The engine's
  list is fetched once per connection (`bots/model-list.ts`). Setup shows the same model and effort (with "Sent as ..."
  under it) and reloads when they change.

### Skills (`web/src/skills/`, #137)

- A "Skills" section in the Setup tab (in its lazy chunk) replaces the old read-only skills line; Abilities keeps
  Toolsets and Connectors. `skills/skill-store.ts` reads `skills.list` for the bots on screen, again on `skills.changed`
  and reconnect. A skill an engine's switch excludes (`excluded`) is not part of the library, so it is left out of the
  list, the count and search, as in `bots.get`. Wording is `skills/skill-lines.ts` only (pure, tested).
- The switch saves at once with `skills.setEnabled`; a refusal puts it back with "Could not switch <skill> off. Try
  again." There is no form to write or edit a skill: bots write them.
- A row opens the skill with `?skill=<name>` on `/bots/$botId`: it replaces the Setup tab's content (avatar and tabs stay)
  as a lazy chunk; changing tab or closing the panel drops it. "Written by" comes from `origin`: a bot's name, "You",
  "Imported" (an engine's skill, also after a bot edited it) or "LilBot".
- Skill text is untrusted. `skills/skill-file-text.tsx` draws a `.md` file with react-markdown (no raw HTML, images
  dropped so nothing is fetched, only http(s) links stay links and open in a new tab; SKILL.md's frontmatter is left out
  since the name and description show above) and any other file as plain text.
- The engine's "Include this engine's skills" switch (#140) has no approved screen yet (`needs-ui`): Paper "19 Plugged
  in" frame 4, with rows grouped by origin, waits for Oscar. `SkillRow` is its own part so that grouping can go on top.

### Routines (`web/src/routines/`, #53)

- They live in the Activity tab ("Routines" card, in its lazy chunk); there is no Routines tab and no form: routines are
  made by asking the bot. `routines/routine-store.ts` reads `routines.list` (and `goals.list` to know which routine
  reviews a goal) for the bots on screen, again on `routines.changed`, `goals.changed` and reconnect. Wording is
  `routines/routine-lines.ts` only (pure, tested).
- A row opens one routine with `?routine=<id>` on `/bots/$botId`: it replaces the whole details panel (avatar and tabs
  included) on the Activity tab, as a lazy chunk; changing tab or closing the panel drops it. The switch pauses and
  resumes (`routines.pause`/`resume`, shown at once and put back on refusal); the bin asks first, then `routines.delete`.
- A goal's review routine (a goal whose `routineId` is this routine) says "For your goal" and shows the goal's words. It
  has no switch and no Delete: LilBot's goal tick puts its state back within seconds (see [goals.md](goals.md)), so a
  control would silently undo itself. It follows the goal.
- A run row opens its transcript with `?run=<id>`, the same column swap as an opened exchange (one of the two at a time):
  the conversation stays mounted, `invisible` and inert. The run's chat (`routines.openRun`) is kept in the view's own
  state, never the bot's chat slot, followed live while it runs, and closed (`chat.close`) when the view goes. Its only
  user message is LilBot's wrapper prompt, so user messages are left out and "The routine asked" shows the routine's
  words. A run not started yet has no transcript and is not a link.

### Webhooks (`web/src/webhooks/`, #138)

- A "Webhooks" section in the Activity tab, under Routines (in its lazy chunk), hidden while the bot has none or the
  read fails (the helper door off refuses every read). No form: webhooks are made by asking the bot.
  `webhooks/webhook-store.ts` reads `webhooks.list` for the bots on screen, again on `webhooks.changed` and reconnect
  (`app/watched-reads.ts`, shared with routines and skills). Wording is `webhooks/webhook-lines.ts` only (pure, tested).
- A row opens one webhook with `?webhook=<id>`, in place of the whole details panel like a routine (opening one closes
  the other). The switch pauses and resumes (`webhooks.pause`/`resume`); the bin asks first, then `webhooks.delete`.
- The address is never in list data, on screen, in a store or a log: "Copy" calls `webhooks.address` on the click and
  hands it to the clipboard as a pending `ClipboardItem` (so Safari keeps the click's permission), `writeText` where
  that is missing. The button says "Copied" or "Could not copy" for two seconds.
- A run row opens its transcript with `?webhookRun=<id>` in the conversation column, like a routine run
  (`routines/run-transcript.tsx`, `webhooks.openRun`): "The webhook asked" shows the task; LilBot's prompt with the
  events is left out like a routine's. `thread`, `run` and `webhookRun` are one column view at a time (`withoutColumn`).
- Not built, waiting for an approved design: Oscar's capability groups (`webhooks.setCapabilities`; Paper "17" frames 7
  to 9 are drawn, not approved) and any drawing of a run's message to its bot beyond the plain `webhook message` tool
  line the history already shows in the conversation.

### Library (`web/src/library/`, #54)

- The Library tab reads `library.list` for one filter (All, Media, or Files: `kinds: ['file', 'page']`, since pages are
  listed with files) and again on `library.changed` for its bot and on reconnect, keeping as many items as were shown;
  "Show more" reads the next page. Groups (Today, This week from Monday, Older) and every line are worked out on the
  device, in its time zone (`library/library-lines.ts`, pure and tested).
- An image or a page opens the viewer (a lazy chunk over the app); any other file, sound and video included, downloads
  with the file's own name; a missing file does nothing. Thumbnails are the image itself (`<img>`, lazy).
- Pages are bot text, never live HTML on LilBot's origin: Markdown is drawn by React with no raw HTML, images shown as
  their words and links opening a new window; an HTML page goes into an `<iframe sandbox="">` (no scripts, forms,
  pop-ups or same origin) whose `srcdoc` starts with a policy refusing every request but inline styles and `data:`
  images. Both read the bytes from the download route; pages over 2 MB only download.
- "Show in chat" opens the routine run (`?run=`) or the bot's conversation the item came from; the data names the chat,
  not the message. A webhook run's file reads "Given in the chat" (its session is recorded as the conversation).
- "Browse the whole workspace" opens `?folder=/<path>` on the Library tab, which replaces the whole panel like a routine
  (`library/workspace-view.tsx`, a lazy chunk); tab links drop it. It is read-only: `library.workspace` gives names and
  sizes, and the download route serves only given items.

### Work between bots (`web/src/threads/`, #65, #135, #136)

- A `tool` item with `threadId` draws as a bordered line from the bot's `threads.list` (`threads/thread-store.ts`, read
  for the bots on screen and again half a second after `threads.changed`); an exchange not read yet, or a group, keeps
  the plain tool line. With a `batchId` it is a handed-over task, without one an asked thread; the delegating side is
  the first participant. Tasks of one batch share one card at the first line; the other lines draw nothing and their
  rows hide. Wording lives in `threads/thread-lines.ts` and, for groups, `threads/group-lines.ts` only.
- A group's line (`threads/group-line.tsx`) is drawn in the leader's and every member's conversation from that bot's
  `threads.list`, with its state from `group` (rounds, replies, how it ended); the wording for an end other than a close
  is LilBot's own, never the server's `end.outcome`. A group runs until `group.end` is set, whatever its status.
- The line, the opened view, the group view (loaded from the opened view), the stop dialog and "Working together"
  are lazy chunks; the chat's first load carries only the `ChatItem` switch, `?thread=` handling and the check whether
  any bot has `groups`.
- "Working together" (`threads/working-together.tsx`): the roster's top section and the rail's group slots, only while a
  bot in `bots.list` has `groups`. Members and the leader come from each bot's `groups`; a row opens
  `/bots/<leader>?thread=<group>`. Row states ("Leading a group", "In a group", "In a group · <activity>") are in
  `bots/row-state.ts`: a member's live activity in `bots.list` is what it does in its group (`groups[].activity`), else
  its usual `activity`, combined with its `groups`.
- Opening sets `?thread=<id>` on `/bots/$botId` (tab links and the panel's auto-open keep it with `search: true`). The
  view covers the conversation column while the conversation stays mounted, `invisible` and inert: its connection
  and scroll position are unchanged. On a phone, opening from the details panel goes to the conversation first.
  "Back to chat" drops the parameter; each bot button opens that bot's chat.
- Stop (a running task's or group's line and its view) asks first, then calls `threads.cancel`; asked threads have no
  Stop. Any participant's line can stop a group.
- Files passed in a group, and the files its leader kept, show as chips that download through the same route as an
  exchange's (`ThreadService.file`). A group closed before #178 has no recorded hash for its kept files, so their chips'
  links answer "File missing or unavailable" (the files are in the leader's Library).
- Oscar never writes in an exchange: no composer.

### Conversation scroll (AI Elements' Message Scroller)

- It opens at its latest message (also after a reload or resume). A sent message moves up and the reply grows below
  it (Oscar's choice); the list follows the reply only while the reader stays at the end.
- Only messages sent while the list is open are scroll anchors: the scroller jumps to any anchor it did not see arrive
  (`chat/scroll-anchors.ts`). Rows are counted by position in the conversation (`ChatView.first` plus the index), and
  each transcript load (`ChatView.load`) moves the end of what counts as arrived, so earlier parts loading above never
  become anchors.
- Rows are memoised and keyed by that position, so a streamed chunk redraws only the last row, an earlier part redraws
  none below it, and a reloaded transcript keeps unchanged item objects (`reuseItems` in `history/history-view.ts`).
- A chat this page has not shown appears from `chat.history` (a database read) while `chat.open` attaches; the message
  box takes typing meanwhile and sends once the chat is open. The list first draws the latest 20 rows, then the
  earlier ones in a transition that yields to typing; the view stays in place as they arrive above.
- Queued messages show as dashed bubbles, the activity line as a shimmering Trace line (not Reasoning: we get a
  status, not thinking text), tool use as Trace lines.

### Conversation history on screen (`web/src/history/`)

- The main conversation is one continuous history across sessions, built from the snapshot's `history` page; other
  chats, such as a routine run, show only their own transcript.
- It opens on its latest part. Scrolling within one screen of the top (or a conversation that fits the screen)
  fetches the next earlier part with `chat.history` and its cursor, one part at a time, drawn in a transition.
- The "Loading earlier messages" line is an overlay, never a row: the scroller keeps the reader's place only when the
  first row is still there and has moved down, so the first row is always a message while more can load.
- Day lines go between two rows on different local days, never above the earliest loaded row unless it is the very
  start. The very start shows only when the server sends `start` (import complete). While the import runs, a
  `history.changed` push for this bot, with the reader at the top, reads the earliest part again (at most every three
  seconds) and adds only rows older than those shown.
- New session: the header button adds a divider at once and keeps the conversation; the new session's snapshot
  replaces it with the saved divider.
- Reopening or reconnecting keeps earlier parts already loaded when the new latest part shares a row with them
  (`withLatest`); rows that arrived live are replaced by their saved copies. `MessageList` is keyed by bot, so a new
  session never remounts the scroller.
