import { Fragment, useState } from 'react'
import { Switch } from '@/ui/switch'
import type { Routine } from '../../../shared/routine-schema'
import { messageOf } from '../app/lilbot-socket'
import { useNow } from '../app/use-now'
import { StatusIcon } from '../bots/status-icon'
import { useRoutineNavigation } from './open-routine'
import { routineLine } from './routine-lines'
import { setPaused, useRoutineGoal, useRoutineStore, useRoutines } from './routine-store'

const hint = 'px-2 pt-0.5 text-xs/4 text-muted-foreground'

/** The Activity tab's "Routines" card (Paper "07 Routines" panel 1): each routine's task on one line, its state under it and
 *  its switch. A row opens the routine. Routines are made by asking the bot, so there is no button for a new one. */
export function RoutinesCard({ botId, botName }: { botId: string; botName: string }) {
  const routines = useRoutines(botId)
  const error = useRoutineStore(state => state.errors[botId])
  const [failure, setFailure] = useState('')
  const now = useNow(30_000)
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="flex justify-between px-2 text-xs/4 text-muted-foreground">
        <span>Routines</span>
        {routines && routines.length > 0 && <span>{routines.length}</span>}
      </h3>
      {!routines ? (
        <p className={hint}>{error || 'Loading...'}</p>
      ) : routines.length === 0 ? (
        <p className={hint}>Ask {botName} in the chat to add one, for example “check the reviews every morning”.</p>
      ) : (
        <>
          <div className="flex flex-col rounded-lg bg-card ring-1 ring-hairline">
            {routines.map((routine, index) => (
              <Fragment key={routine.id}>
                {index > 0 && <div className="h-px bg-foreground/6" />}
                <Row botId={botId} routine={routine} now={now} onFailure={setFailure} />
              </Fragment>
            ))}
          </div>
          {failure && <p className={`${hint} text-destructive`}>{failure}</p>}
          <p className={hint}>Ask {botName} in the chat to add or change one.</p>
        </>
      )}
    </section>
  )
}

function Row({ botId, routine, now, onFailure }: { botId: string; routine: Routine; now: number; onFailure: (text: string) => void }) {
  const { open } = useRoutineNavigation()
  const goal = useRoutineGoal(botId, routine.id)
  const line = routineLine(routine, now)
  return (
    <div className="flex items-center gap-3 pr-3 first:rounded-t-lg last:rounded-b-lg hover:bg-foreground/4">
      <button
        type="button"
        onClick={() => void open(routine.id)}
        className="flex min-w-0 flex-1 flex-col py-2.5 pl-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className={`truncate text-[13px]/[18px] font-medium ${line.tone === 'paused' ? 'text-foreground/70' : ''}`}>{routine.description}</span>
        <span className="flex min-w-0 items-center gap-[5px]">
          {line.tone === 'running' && <StatusIcon tone="working" />}
          <span className={`truncate text-xs/4 ${line.tone === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{line.text}</span>
        </span>
      </button>
      <RoutineSwitch botId={botId} routine={routine} goal={goal} onFailure={onFailure} />
    </div>
  )
}

/** On while the routine runs on its schedule. A goal's review routine follows its goal, so it has no switch of its own. */
export function RoutineSwitch({ botId, routine, goal, onFailure }: { botId: string; routine: Routine; goal: string | undefined; onFailure: (text: string) => void }) {
  if (goal) return null
  const change = (on: boolean) => {
    onFailure('')
    setPaused(botId, routine, !on).catch(failure => onFailure(`Could not ${on ? 'resume' : 'pause'} it. ${messageOf(failure)}`))
  }
  return <Switch checked={!routine.paused} onCheckedChange={change} aria-label={routine.paused ? 'Resume this routine' : 'Pause this routine'} />
}
