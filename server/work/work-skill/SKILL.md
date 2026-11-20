---
name: lilbot-work
description: Use for work that takes more than a reply (handed to you or by you, scheduled, triggered from outside, or changing something). How to choose the kind and check level, write the "done" definition before you start, and what counts as real evidence on your work board (lilbot_work).
---

# Working on the board

Every real piece of work is an item on your board: Oscar reads it instead of asking you. Open one with
`lilbot_work` (no itemId) before you start; report on it with its itemId as you go. Answering a question,
explaining or chatting is not an item.

## 1. Say what kind of work it is, and how much it is checked

Give `kind` when you open the item. Each kind has a default check level, which Oscar may have changed for you;
LilBot refuses a level below it and never lets it go down later.

- `reply`, `note` (level 0): answers, drafts, notes, reading. No check.
- `file`, `computer`, `code` (level 1): a file or report, a change on a computer, a code change. You read the
  real result yourself and attach the evidence.
- `deploy`, `outside` (a message or post that leaves the system), `spending`, `figure` (a number Oscar will
  decide on) (level 2): another bot, chosen by LilBot, reproduces your claim before the item is done.
- Raise the level for anything hard to undo (deleting data, a change others depend on): 2 for a second bot,
  3 when Oscar must look himself.

## 2. Write "done" before you start

The definition says how you, Oscar or another bot will know the work is done, without taking your word for it.

- Name the observable result and where to look: a file and what it contains, a page and what it shows, a
  command and what it prints, a number and its source.
- Be specific enough that someone else could check it: "`~/reports/sales.md` lists the 12 months of 2026 with a
  total that matches the dashboard" — not "write the report".
- Include the limits Oscar gave: deadline, scope, what must not change.
- Write it from the request, not from what turned out easy. If the request is unclear, ask first (status
  `needs_oscar` with one question), then write it.

## 3. Evidence is the real thing, read after the work

Each entry says what it proves and points at one real thing you read yourself, after doing the work:

- `library`: a file you gave to the Library (`give_file`), for results Oscar should open.
- `url`: a page you opened and saw the result on.
- `command` and `output`: the read-only command you ran to check the result, and the part of its output that
  shows it (`cat`, `ls -l`, `git log -1`, `curl -s`, a test run). Use absolute paths, so another bot can repeat it.
- `value`, `source` and `readAt`: a number, where you read it and when.

Not evidence: what you remember, what a tool said it would do, the command that made the change (its exit code
shows it ran, not that the result is right), or another bot's claim you did not check. Never put secrets in
evidence; show the part of an output that proves the point.

## 4. Report as you go

- `working` once the definition is written. Done without a definition or evidence is refused unless the item was
  opened at level 0 (answers, drafts, notes, reading; level 1 is the default).
- `needs_oscar` with exactly one question when only Oscar can decide: say what you need and the choices. You are
  marked unread; carry on with other work. His answer arrives as a new turn.
- `done` with a result: one or two sentences on what came of it and where it is. One call can add the evidence
  and finish. At level 2 the item then shows `checking` while another bot reproduces your claim; you can report
  nothing more on it meanwhile. Verified, it is done. Not verified, it comes back to you once with what the
  checker saw: fix the work and finish again; a second failure goes to Oscar. At level 3, or when no other bot
  can check, it waits for Oscar, who passes it or sends it back.
- `failed` with what went wrong and what you tried; `dropped` with the reason. Nothing is deleted.
- Oscar can drop an item, and items handed over under it: LilBot tells you in the session the item belongs to. Stop
  that work at once, report nothing more on it (the board refuses it) and say in one line that you stopped.

## 5. Handing work over

Hand work over with `lilbot_delegate` while you work on the item (pass `itemId` when you have several open). The
other bot's task becomes its own child item. Before you finish yours, read the child (`lilbot_work_list` with its
itemId) and check its evidence; your own evidence is still the real result you read.

## Recipes

Bots may add recipes for a kind of work (a deploy, a report, a post) as their own skills: the usual "done"
definition and the checks that prove it.
