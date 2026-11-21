# Goals

`server/goals/` owns goals (`shared/goal-schema.ts`, #143). Oscar gives an outcome once, in his words; the bot proposes
an agreement and a target measured from a real source; once he agrees, the bot works on the board and LilBot's review
routine reports against the target on a rhythm. The bot promises the work and measures honestly; it does not promise the
number. How to propose and review is the guide topic `goals` (no skill: a skill's catalogue line costs every turn). The
short version is in `AGENTS.md` under "Goals".

## Record and lifecycle

- A goal belongs to one bot: Oscar's words, the agreement (what it does alone, needs from Oscar: access, money, a
  decision; cannot influence), the target (measure, source, the baseline value with the time LilBot saved it and one
  evidence pointer of the reading, the target value, a due date `YYYY-MM-DD` in Adelaide), the review rhythm (a routine
  schedule, default weekly on Monday at 09:00 Adelaide) and a state: `proposed`, `agreed`, `paused`, `reached`, `dropped`
  (the last two final). Events and reviews are never deleted (`goal_events`, `goal_reviews`).
- Nothing proactive before Oscar agrees: a work item links to a goal (`goalId` at opening, nullable `work_items.goal_id`)
  only while it is the bot's own and `agreed` (`WorkHost.checkGoal`); reviews likewise; there is no routine before.
- Reached only when the latest review met the target and its work item is `done` (checked at its level), never on the
  bot's number alone; the routine is then removed.
- `goals.drop` drops every unfinished item of the goal in the same transaction (`WorkBoard.dropping`, the same as
  `work.drop`, which tells the bot about each); only with none does the bot get the goal's own notice. A deleted bot's
  goals are dropped ("The bot was deleted."); its routines go with it.

## Bot tools and Oscar's methods

- Bot tool (System MCP): `lilbot_goal` with `action`. `propose` without goalId: a new goal, only from a conversation
  session (never a routine or webhook run, an exchange or a check; the call is traced like `lilbot_work`), with Oscar's
  words, the agreement and the target; with goalId, a new version of a proposed goal or a change to an agreed or paused
  one (`why`; a new agreement, target or rhythm, or `drop`). `progress`: a review. Reads go through `lilbot_work_list`
  (`goals`, `goalId`), so goals add one listing line per turn. Request ids make retries safe; text passes `memoryRefusal`;
  a target differs from its baseline and is due today or later; a rhythm keeps the routines' minimum interval.
- Oscar: `goals.list` (bot, states), `goals.open` (its reviews, work items and events), `goals.agree` (a proposed goal
  starts, a paused one resumes, a proposed change applies and a proposal to drop drops it; `review` replaces the rhythm),
  `goals.adjust` (his words; the bot proposes again), `goals.pause`, `goals.drop` (optional reason), push
  `goals.changed`. A proposed goal or a change waits for Oscar: the bot shows waiting and turns unread (`goal:<id>`),
  like a `needs_oscar` item, and it is not also a work item, so he has one way to answer. Screens: `needs-ui`.
- Each decision is saved with its notice in one transaction. Notices are hidden turns in the bot's main conversation
  through `work_answers` (`WorkAnswers.notify`, stable run ids): agreed (open an item per thing it does alone and a
  `needs_oscar` item with one question per thing it needs from Oscar), resumed, change applied, adjusted, paused,
  dropped.

## Review routine and reviews

- The review routine (`goal-routines.ts`) is made through `RoutineService.create` once the goal is agreed, with
  `createdBy: oscar` (his agreement is the request), so it is not one of the bot's five; request id `goal-<id>-<n>`. A
  tick every five seconds keeps it matching the goal: running while agreed, paused while paused, removed otherwise, on
  the goal's rhythm (a new rhythm replaces it as `n+1`); one the bot paused or deleted with its routine tools comes back.
  Its task names the goal and reads it live, so a changed target needs no new routine.
- A review comes only from a run of the goal's own review routine (the calling session's routine), so reviews keep the
  rhythm; it needs the value read now, `did` (what the bot did of what it said) and evidence. LilBot compares the value
  with the previous review (or the baseline) and the target: moved toward, away or not at all, met, and stalled (not
  met, and nothing moved toward the target in this and the previous review, or past due). A stalled review is refused
  without a change or drop in the same call, unless one already waits. The report becomes a work item through
  `WorkService.act`, linked to the goal: kind `figure` (level 2 by default, so a second bot, or a fresh session of the
  bot when it is the only one, reproduces the reading; Oscar may change the default), the reading as a number entry plus
  the bot's own evidence, and a result that keeps "Number: ..." and "Work: ... (items for the goal: ...)" apart. Review
  items are not counted as the goal's work.
