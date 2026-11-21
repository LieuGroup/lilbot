# Screens

Visual specs for the built web screens. The decided behaviour (scroll rules, menus, deletion, panel) is in
`AGENTS.md` under "Web app"; this file holds sizes, copy and the Paper frame each screen follows. Colours, type scale
and icon sizes follow the Stack rules in `AGENTS.md`.

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
`activity/activity-since.ts`), "With other bots" (below), "Routines" (below) and the workspace folder (click copies
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
  download and close. Built for the Library to reuse.
- "Model cannot see images": a tinted note under the message with a "Change model" link to the Setup tab.
