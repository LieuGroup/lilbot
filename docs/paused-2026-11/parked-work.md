# Parked work at the pause (27 Nov 2026)

Back to [the pause record](../paused-2026-11.md). Every PR below is open, CI `verify` green on the head shown, and not
merged. Heads are short commit ids on GitHub; check the PR before resuming in case someone pushed since.

## Web and server

### PR 334: one Copy per turn (the owner's bots)

- **Branch / head:** `engineer/317-copy-per-turn` at `ac8191bc`. Not a draft.
- **What it does:** fixes the regression on main where two turns share one Copy. Only
  `shared/client/chat/reply-actions.ts` changes: a reply now also ends after a part that carries the turn's numbers or
  a "stopped" mark, and at an error line.
- **Review state:** every check passed except the browser look. Unit reproduction gives four Copy rows where main gave
  two; each part of the rule is caught by a test; verify passes on the head and on a merge with main. JS first load
  211.9 kB of 220 kB; CSS 18.9 kB against the 19 kB gate. Its PR body names some home-relative paths worth trimming.
- **Still merged with 334:** a turn ending on a tool line with no closing words, followed by a bot-run turn.
- **Next step:** browser look on the development setup at 390 and 1440 px, light and dark, capturing what Copy writes;
  then the verdict and the merge.

### PR 325: record only sessions LilBot owns, and place each item where it was sent

- **Branch / head:** `fix/conversation-record-scope` at `1a5bb52f`. Draft.
- **What it does:** a chat started in Hermes's own app no longer enters a LilBot bot's conversation, journal, search,
  activity, unread or memory paths (`history_owned`, `chatKinds` returns `outside` for them). A message sent while the
  bot is busy is placed by journal order (`history_sent`). Adds database step 46.
- **Review state:** reviewed to "merge as it is once 334 lands, with the updated `reply-actions-waiting` test". Local
  verify 2156/0. Live `check:record-scope` passed 5/5 on an earlier head (`6389d582`), not on `1a5bb52f`.
- **Next step:** after 334 is on main, merge main in and replace `tests/web/reply-actions-waiting.test.ts` with
  [the prepared test](reply-actions-waiting-after-334.md) as one commit. Run one locked `check:record-scope` on the
  new head, confirm verify and CI, mark ready, merge.

### PR 321: LilBot's neutral base prompt and the tool-name guard

- **Branch / head:** `capy/base-prompt-v2` at `332b8f80` (contains main `310a19949`). Draft.
- **What it does:** puts the tested "What to do when" base prompt in as version 3 (neutral "the owner" wording), a
  shorter name-free system note and skills header when LilBot owns the prompt, and a shared allow-list guard for live
  checks that lets a tool through only when the request offers that exact name. It rewrites
  `live-checks/workspace-guard.ts` (`assertInside` takes a policy), so new live checks should build on it.
- **Review state:** two review rounds; the second round's findings are fixed on this head. Guarded `check:prompt`
  passed on clean `332b8f80`. The final `check:prompt-behaviour` run was stopped part-way by the pause; its early
  failures were the upstream model proxy (HTTP 500s, turn timeouts), not model behaviour.
- **Next step:** one full `check:prompt-behaviour` on the head (after merging newer main), its table in the PR body,
  out of draft, re-review. The owner approves the wording before the prompt setting is switched on for existing bots.

## iPhone

### PR 310: folded Duo in landscape

- **Branch / head:** `capy/ios-duo-folded-landscape` at `ead86bb9`. Draft.
- **What it does:** treats a folded Duo in landscape as folded Duo, with one ••• in the strip ("Bot details" first)
  and the bot menu kept in landscape.
- **Review state:** code passed. Three folded-landscape default-text pictures must be retaken: chat with keyboard up,
  roster, roster search. Conflicts with the owner's bots' PR 319; whichever lands second gets a review of the merged
  ••• menu.
- **Next step:** retake the three frames from a clean build of `ead86bb9`, checking each frame shows the screen its
  title names, then mark ready for review.

### PR 308: phone card for a refused memory save

- **Branch / head:** `capy/ios-checkpoint-refusal` at `0dfb1816`. Draft. Main is merged in.
- **What it does:** shows the conversation card when the pre-compress memory save is refused.
- **Review state:** landscape pictures never taken.
- **Next step:** clean build, landscape proof set, review.

### PR 339: iPhone Settings › Memory

- **Branch / head:** `capy/ios-memory` at `a498069f`. Draft.
- **What it does:** one place for memory on the iPhone, matching the web Settings › Memory page and the owner-approved
  landscape frames.
- **Review state:** clean Release simulator build succeeded; ordinary iPhone portrait at default text matches the
  frames, and the add-a-fact and search keyboard checks passed. **Open defect:** rotating the ordinary iPhone with a
  fact open closes the fact sheet (cause not found). Landscape, largest text, dark and Duo poses were not run.
- **Next step:** fix the rotation defect, push, rebuild cleanly, run the full proof matrix, post it on the PR for
  review. Folded Duo landscape waits on PR 310.

### Branch `capy/ios-notifications-v2`: iPhone notifications (no PR yet)

- **Head:** `5d645f95`.
- **What it does:** Settings › Notifications (Turn on / Open iOS Settings / phone switch, five event switches,
  lock-screen text, muted bots), device token registration, presence and tap routing. iOS asks permission only when
  Turn on is tapped. The push entitlement stays off unless `IOS_PUSH_NOTIFICATIONS=1`; a clean Release build has no
  `aps-environment`, and nothing contacted Apple or a phone. `5d645f95` fixes a crash after connect (the bot menu
  selector returned a fresh array each render) and adds a guard test.
- **Review state:** verify and the iOS typecheck pass. Only three simulator passes completed (iPhone portrait at
  largest text, folded and unfolded Duo portrait). After Allow, the page stayed on "Turning on…" with switches greyed
  out; likely `getDevicePushTokenAsync` never resolving in a build without the entitlement.
- **Next step:** time out `getDeviceToken` in `native-bridge.ts` so Turn on finishes without a token; rerun the proof
  set on an idle Mac; open the PR. The Apple push capability step waits for the owner.
- An older copy, `capy/ios-notifications` (`edb08129`), is superseded by this branch and can be ignored.

### Kept branch

`capy/ios-bot-details-and-settings` (PR 302, merged) stays: the owner's bots' PR 319 (one ••• per chat screen) is
based on it.

### Not started

- **PR 302 follow-up** (no branch): Setup Instructions line under the Save bar; strip clock over the rename field; the
  "inform" button cut by the bar; tab bar over the last Settings rows; copy/paste menu over the rename buttons; Work
  tab bar over the Answer field in iPhone landscape at the largest text size; strip buttons about 7 pt from the edge
  in flipped folded landscape; bot name cut off in the menu at the largest text size. Plus a test that fails when the
  side-strip check is removed from folded-Duo detection.
- **Received-tasks dock proof** (#326/#327, merged): pass 1 covered folded and unfolded Duo portrait. Still owed:
  ordinary iPhone portrait and landscape, unfolded Duo landscape, the Stop sheet at the largest text size, and the
  written verdict. Folded Duo landscape waits on PR 310. The 11 pt group label is below the phone type scale.
