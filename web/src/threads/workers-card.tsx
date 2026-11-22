import { ChevronRightIcon } from 'lucide-react'
import { Fragment } from 'react'
import { useNow } from '../app/use-now'
import { useThreadNavigation } from './open-thread'
import { StateText } from './state-text'
import { activityOrder, isWorker, running } from './thread-lines'
import { useThreads, useWaitingWork } from './thread-store'
import { workerActivityRow } from './worker-lines'

/** The Activity tab's "Workers" card (Paper "22 Workers" frame 7): permanent history of this bot's own workers, running
 *  first then newest, sitting above "With other bots" and hidden when the bot has no workers. */
export function WorkersCard({ botId }: { botId: string }) {
  const threads = useThreads(botId)
  const waitingWork = useWaitingWork()
  const now = useNow(15_000)
  const { open } = useThreadNavigation(botId)
  const list = activityOrder((threads ?? []).filter(isWorker)).sort(
    (a, b) => Number(waitingWork[b.id]?.status === 'needs_oscar' && b.status !== 'cancelled') - Number(waitingWork[a.id]?.status === 'needs_oscar' && a.status !== 'cancelled')
  )
  if (list.length === 0) return null
  const busy = list.filter(running).length
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="flex justify-between px-2 text-xs text-muted-foreground">
        <span>Workers</span>
        <span>{busy > 0 ? `${busy} running` : list.length}</span>
      </h3>
      <div className="flex flex-col rounded-lg bg-card ring-1 ring-hairline">
        {list.map((thread, index) => {
          const row = workerActivityRow(thread, now, waitingWork[thread.id])
          return (
            <Fragment key={thread.id}>
              {index > 0 && <div className="h-px bg-foreground/6" />}
              <button
                type="button"
                onClick={() => void open(thread.id)}
                className="flex items-center gap-2.5 py-2.5 pr-2.5 pl-3 text-left outline-none first:rounded-t-lg last:rounded-b-lg hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={`truncate text-[13px]/[18px] font-medium ${row.state.stopped ? 'text-muted-foreground' : ''}`}>{row.title}</span>
                  <StateText state={row.state} strong={row.state.icon === 'waiting'} />
                </span>
                <ChevronRightIcon aria-hidden className="size-3.5 flex-none text-foreground/40" strokeWidth={1.75} />
              </button>
            </Fragment>
          )
        })}
      </div>
    </section>
  )
}
