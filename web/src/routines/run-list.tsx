import { CheckIcon, ChevronRightIcon, LoaderCircleIcon, SquareIcon, XIcon } from 'lucide-react'
import { Fragment, useState } from 'react'
import type { RoutineRun } from '../../../shared/routine-schema'
import { sessionTime } from '../history/history-labels'
import { useRunNavigation } from './open-routine'
import { runLine } from './routine-lines'

const FIRST = 5
const MORE = 10

/** The "Runs" card: newest first, each with its state, when it was due and its result; a row opens the run's transcript in
 *  the conversation column. A run that has not started has no transcript yet. */
export function RunList({ botId, runs }: { botId: string; runs: RoutineRun[] }) {
  const [shown, setShown] = useState(FIRST)
  const { open } = useRunNavigation(botId)
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="px-2 text-xs/4 text-muted-foreground">Runs</h3>
      {runs.length === 0 ? (
        <p className="px-2 text-xs/4 text-muted-foreground">No runs yet.</p>
      ) : (
        <div className="flex flex-col rounded-lg bg-card ring-1 ring-hairline">
          {runs.slice(0, shown).map((run, index) => (
            <Fragment key={run.id}>
              {index > 0 && <div className="h-px bg-foreground/6" />}
              <button
                type="button"
                disabled={!run.chatId}
                onClick={() => void open(run.id)}
                className="flex items-start gap-2.5 py-2.5 pr-2.5 pl-3 text-left outline-none first:rounded-t-lg last:rounded-b-lg focus-visible:ring-2 focus-visible:ring-ring enabled:hover:bg-foreground/4"
              >
                <RunIcon status={run.status} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[13px]/[18px] font-medium">{sessionTime(run.dueAt)}</span>
                  <span className={`line-clamp-2 text-xs/4 break-words ${run.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{runLine(run)}</span>
                </span>
                {run.chatId && <ChevronRightIcon aria-hidden className="h-[18px] w-3.5 flex-none text-foreground/40" strokeWidth={1.75} />}
              </button>
            </Fragment>
          ))}
        </div>
      )}
      {runs.length > shown && (
        <button
          type="button"
          onClick={() => setShown(count => count + MORE)}
          className="self-start rounded-sm px-2 pt-1 text-xs/4 font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Show older runs
        </button>
      )}
    </section>
  )
}

/** Green check finished, red cross failed, grey square stopped, blue spinner running or about to start. */
function RunIcon({ status }: { status: RoutineRun['status'] }) {
  const box = 'h-[18px] w-3.5 flex-none'
  switch (status) {
    case 'completed':
      return <CheckIcon aria-label="Finished" className={`${box} text-success`} strokeWidth={2.5} />
    case 'failed':
      return <XIcon aria-label="Failed" className={`${box} text-destructive`} strokeWidth={2.5} />
    case 'stopped':
      return <SquareIcon aria-label="Stopped" className={`${box} scale-[0.6] fill-foreground/40 text-transparent`} />
    default:
      return <LoaderCircleIcon aria-label="Running" className={`${box} animate-spin text-primary`} strokeWidth={2.5} />
  }
}
