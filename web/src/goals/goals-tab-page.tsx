/** "Goals" tab on the Work board: active goals with progress bars, proposals, paused, and reached/dropped below (Paper artboard 20, frame 11). */
import { Link } from '@tanstack/react-router'
import { CheckIcon } from 'lucide-react'
import { Fragment } from 'react'
import { Notice } from '@/ui/notice'
import type { Goal } from '../../../shared/goal-schema'
import { useNow } from '../app/use-now'
import { ThreadAvatar } from '../threads/thread-avatar'
import { useNeedsOscarWork } from '../work/work-store'
import { formatGoalNumber, goalProgress, shortDate, sortGoals } from './goal-lines'
import { useAllGoals } from './goal-store'

export default function GoalsTabPage() {
  const now = useNow(60_000)
  const { goals, loaded, error } = useAllGoals()
  const items = useNeedsOscarWork()

  const needsByGoal: Record<string, number> = {}
  for (const item of items) {
    if (item.goalId) needsByGoal[item.goalId] = (needsByGoal[item.goalId] ?? 0) + 1
  }

  const { active, finished } = sortGoals(goals)

  return (
    <div className="mx-auto flex max-w-[560px] flex-col gap-4 px-5 py-5 md:px-6">
      {error && <Notice tone="error">{error}</Notice>}
      {!loaded && !error && <p className="text-[13px] text-muted-foreground">Loading goals...</p>}

      {loaded && active.length === 0 && finished.length === 0 && <p className="text-[13px]/5 text-muted-foreground">No goals yet. Give a goal by telling a bot in its chat.</p>}

      {active.length > 0 && (
        <div className="flex flex-col rounded-2xl ring-1 ring-hairline">
          {active.map((goal, index) => (
            <Fragment key={goal.id}>
              {index > 0 && <div className="h-px bg-foreground/6" />}
              <GoalRow goal={goal} needs={needsByGoal[goal.id] ?? 0} now={now} />
            </Fragment>
          ))}
        </div>
      )}

      <p className="text-xs/4 text-muted-foreground">A goal is given by telling a bot in its chat.</p>

      {finished.length > 0 && (
        <section className="flex flex-col gap-2 pt-1">
          <h2 className="text-xs/4 text-muted-foreground">Reached and dropped</h2>
          <div className="flex flex-col rounded-2xl ring-1 ring-hairline">
            {finished.map((goal, index) => (
              <Fragment key={goal.id}>
                {index > 0 && <div className="h-px bg-foreground/6" />}
                <GoalRow goal={goal} needs={0} now={now} />
              </Fragment>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function GoalRow({ goal, needs, now }: { goal: Goal; needs: number; now: number }) {
  const muted = goal.state === 'paused' || goal.state === 'dropped'
  const current = goal.latest?.value ?? goal.target.baseline.value
  const pct = goalProgress(goal)

  return (
    <Link
      to="/work/goals/$goalId"
      params={{ goalId: goal.id }}
      className="flex items-center gap-2.5 px-3.5 py-3 outline-none transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ThreadAvatar id={goal.botId} name={goal.botName} size={20} />
      <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
        <span className={`truncate text-[13px]/[18px] font-medium ${muted ? 'text-muted-foreground' : 'text-foreground'}`}>{goal.text}</span>
        {goal.state === 'agreed' && (
          <>
            <div className="flex h-1 overflow-hidden rounded-full bg-foreground/8">
              <div className="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs/4 text-muted-foreground">
              {formatGoalNumber(current)} of {formatGoalNumber(goal.target.value)} {goal.target.measure}
              {needs > 0 && ` · ${needs} needs you`}
              {goal.proposal && <span className="text-primary"> · change proposed</span>}
            </span>
          </>
        )}
        {goal.state === 'proposed' && (
          <span className={`text-xs/4 ${goal.waitsForOscar ? 'text-primary' : 'text-muted-foreground'}`}>
            {goal.waitsForOscar ? 'Agreement waits for you' : 'Waiting for revised agreement'}
          </span>
        )}
        {goal.state === 'paused' && (
          <span className="text-xs/4 text-muted-foreground">
            Paused · {shortDate(goal.updatedAt, now)}
            {goal.proposal && <span className="text-primary"> · change proposed</span>}
          </span>
        )}
        {goal.state === 'reached' && (
          <span className="inline-flex items-center gap-1 text-xs/4 text-success">
            <CheckIcon className="size-3" strokeWidth={2.5} aria-hidden />
            Reached · {shortDate(goal.finishedAt ?? goal.updatedAt, now)}
          </span>
        )}
        {goal.state === 'dropped' && <span className="text-xs/4 text-muted-foreground">Dropped · {shortDate(goal.finishedAt ?? goal.updatedAt, now)}</span>}
      </div>
    </Link>
  )
}
