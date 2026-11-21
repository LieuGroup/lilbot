# Screens

Visual specs for the built web screens. The decided behaviour (scroll rules, menus, deletion, panel) is in
`AGENTS.md` under "Web app"; this file holds sizes, copy and the Paper frame each screen follows. Colours, type scale
and icon sizes follow the Stack rules in `AGENTS.md`.

## Layout (`app/router.tsx`)

- Wide screen: roster 272px and details panel 332px on the page tint (`bg-background`), the conversation on
  `bg-card`; a `hairline` divides them.
- Roster (`bots/bot-sidebar.tsx`, Paper "16 Roster: pinned tiles and collapsed rail"): app icon, then collapse
  (wide screens only), search and new bot; the tiles (or the primary's row); sections as 12px labels; collapsed
  "Unassigned" and "Hidden" groups with counts. Grouping is `bots/roster-groups.ts`.
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
`activity/activity-since.ts`), a Routines placeholder and the workspace folder (click copies the path; a browser
cannot open a server folder).

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
