import { ChevronLeftIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/ui/button'
import { Fact } from '@/ui/fact'
import { iconButton } from '@/ui/icon-button'
import { useNow } from '../app/use-now'
import { DeleteRoutineDialog } from './delete-routine-dialog'
import { useRoutineNavigation } from './open-routine'
import { createdText, scheduleLabel, whenNext } from './routine-lines'
import { useRoutineGoal, useRoutines } from './routine-store'
import { RoutineSwitch } from './routines-card'
import { RunList } from './run-list'

const note = 'px-2 text-xs/4 text-muted-foreground'

/** One routine, in place of the whole details panel (Paper "07 Routines" panel 2): a 52px bar with "Routines" and Delete,
 *  the full task with its switch, the facts and the runs. A goal's review routine follows its goal: no switch or Delete. */
export default function RoutineDetail({ botId, routineId }: { botId: string; routineId: string }) {
  const routines = useRoutines(botId)
  const goal = useRoutineGoal(botId, routineId)
  const { close } = useRoutineNavigation()
  const [deleting, setDeleting] = useState(false)
  const [failure, setFailure] = useState('')
  const now = useNow(30_000)
  const routine = routines?.find(candidate => candidate.id === routineId)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[calc(52px+env(safe-area-inset-top))] flex-none items-center justify-between pt-[env(safe-area-inset-top)] pr-2.5 pl-2">
        <Button variant="ghost" className="h-auto gap-0.5 rounded-md py-[5px] pr-2 pl-1 text-[13px]/[18px] font-medium hover:bg-foreground/4" onClick={() => void close()}>
          <ChevronLeftIcon className="size-4" strokeWidth={1.75} />
          Routines
        </Button>
        {routine && !goal && (
          <Button variant="ghost" size="icon-sm" className={iconButton()} onClick={() => setDeleting(true)} aria-label="Delete this routine" title="Delete this routine">
            <Trash2Icon />
          </Button>
        )}
      </div>
      {!routine ? (
        <p className="px-5 py-2 text-[13px]/[18px] text-muted-foreground">{routines ? 'This routine was deleted.' : 'Loading...'}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pt-1 pb-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-start gap-3 px-2">
              <p className={`flex-1 text-sm/[21px] font-medium break-words whitespace-pre-wrap ${routine.paused ? 'text-foreground/70' : ''}`}>{routine.description}</p>
              <span className="flex h-[21px] items-center">
                <RoutineSwitch botId={botId} routine={routine} goal={goal} onFailure={setFailure} />
              </span>
            </div>
            {failure && <p className={`${note} text-destructive`}>{failure}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <dl className="flex flex-col rounded-lg bg-card ring-1 ring-hairline">
              <Fact label="Schedule" value={scheduleLabel(routine.schedule)} />
              <Fact label="Next run" value={routine.paused ? 'Paused' : whenNext(routine.nextRunAt, now)} />
              <Fact label="Created" value={createdText(routine, goal)} />
            </dl>
            {goal && <p className={note}>It reviews your goal “{goal}”. It runs while the goal is agreed and pauses with it, so it has no switch of its own.</p>}
          </div>
          <RunList botId={botId} runs={routine.runs} />
        </div>
      )}
      {deleting && routine && <DeleteRoutineDialog botId={botId} routine={routine} onClose={() => setDeleting(false)} />}
    </div>
  )
}
