# Screens

Visual specs for the built web screens. The decided behaviour (scroll rules, menus, deletion, panel) is in
`AGENTS.md` under "Web app"; this file holds sizes, copy and the Paper frame each screen follows. Colours, type scale
and icon sizes follow the Stack rules in `AGENTS.md`.

## Layout (`app/router.tsx`)

- Wide screen: roster 272px and details panel 332px on the page tint (`bg-background`), the conversation on
  `bg-card`; a `hairline` divides them.
- Roster (`bots/bot-sidebar.tsx`, Paper "16 Roster: pinned tiles and collapsed rail"): app icon, then collapse
  (wide screens only), search and new bot; the tiles; sections as 12px labels; collapsed "Unassigned" and "Hidden"
  groups with counts. Grouping is `bots/roster-groups.ts`.
- Tiles (`bots/roster-tiles.tsx`): 82px wide, radius 12, a 52px avatar and the name under it (12/16, weight 500, one
  line with an ellipsis); three fit across at 272px and more wrap. Primary first with a star badge at the avatar's
  bottom right, then pinned bots oldest pin first. Unread: a 600 name and a 12px blue dot at the avatar's top right.
  Working: a small blue spinner badge in place of the star. Open: the pressed tint (`foreground/6`). No status line:
  the title gives the name and the row's one-line state. A 20px "more" button appears at the top right on hover.
- Rail (`bots/roster-rail.tsx`): 64px. The app icon, then 36px avatars in 48px slots (radius 12) in the roster's
  order, with a 28px hairline between groups; open groups only. Same dot, spinner, star and open tint, scaled down.
  Pointing at an avatar shows a dark label (`ui/tooltip.tsx`) with the name (13/18, 500) and the state (12/16, 70%).
  Foot: open roster, search (opens the roster with the search box focused), new bot, settings, the user (or a red
  dot while offline). The deployment failure notice shows only in the open roster.
- Row (52px), one line from `bots/row-state.ts`: working (blue spinner and the activity text), "Waiting for you",
  finished (green check), failed (red cross), or, idle, the bot's function (no message preview in the data yet).
  Unread rows have a 600 name and a blue dot; on hover the "more" button replaces the dot.
- Footer: the user, a Settings button and, while the socket is down, "Offline · reconnecting" with a red dot (the
  composer then says "Reconnecting...").
- Chat header, one 52px line: name, function, new session and the details toggle.
- Conversation column max 680px: bot text without a bubble (15/24), the user's message in a tinted bubble, tool lines
  13px, a round composer with a plus button for files and an ink send/stop button (stop while the bot works and the
  box is empty with no files).

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

## Computers (`web/src/computers/`, Paper "12 Computers", lazy page of Settings)

- Title row: "Computers" and the ink "Add this computer" button. Until the browser flow (#60) exists the button opens a
  "Coming soon" note.
- One card (`bg-background`, 12 radius, hairline dividers), one row per machine, the leader first: 8px dot (`success`
  online, `foreground/20` offline, `destructive` key conflict), name 13/500, a 12px line (`computer-rows.ts`: "Linux ·
  where LilBot runs · online", "macOS · offline · last seen 2 hours ago", the red key-conflict sentence) and Remove
  (not on the leader), which asks "Remove <name>?" first. The list reads `computers.list` again on every
  `computers.changed`; the page's 30-second tick keeps "last seen" counting.
- Under the card: "Every bot can use every computer here. Offline machines pick up queued work when they wake." At the
  bottom, the link "Add a machine without a screen…".
- Add by command line (`command-line-dialog.tsx`, 432px): a name field and "Create command"; the code is minted only
  then (`computers.installCode`), shown inside `printf '%s' '<code>' | ./lilbot-helper install <helper door>`
  (`install-command.ts`) with Copy and "Valid for m:ss more". When it runs out the page drops the code and says so. The
  code is never logged, stored or kept after the dialog closes.

## Details panel (`bots/bot-details-panel.tsx`)

Avatar, name and pill tabs. Activity shows the live state (with how long, only when this browser saw it start:
`activity/activity-since.ts`), a Routines placeholder and the workspace folder (click copies the path; a browser
cannot open a server folder).

## Conversation history (Paper "11 Conversation history", `web/src/history/`)

- Loading line: "Loading earlier messages" with a spinner, floating at the top. Measured movement of the visible row
  when a part arrives is under 1 px.
- Day lines: 12px, `foreground/50`, "Mon 9 Nov", with the year for another year.
- The very start: the bot's avatar (44px), its name and "Your conversation started on 3 September 2026".
- "Latest": a floating pill (arrow and "Latest") at the bottom centre while scrolled up.
- Session divider: a hairline with "New session" and its time ("Today 14:20", "Yesterday 09:05", "Tue 10 Nov 08:00").
  Only the newest has the line "<bot> starts fresh from here. It keeps its memory and can search what was said
  above."

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
