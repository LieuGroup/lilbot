import { ClockIcon } from 'lucide-react'
import { useRunNavigation } from './open-routine'
import { runHeader } from './routine-lines'
import { useRoutines } from './routine-store'
import { RunTranscript } from './run-transcript'

/** A routine run's transcript in the conversation column (Paper "07 Routines" panel 3), under "The routine asked". */
export default function RunView({ botId, runId }: { botId: string; runId: string }) {
  const routines = useRoutines(botId)
  const { close } = useRunNavigation(botId)
  const routine = routines?.find(candidate => candidate.runs.some(run => run.id === runId))
  const run = routine?.runs.find(candidate => candidate.id === runId)
  return (
    <RunTranscript
      botId={botId}
      runId={runId}
      open="routines.openRun"
      icon={ClockIcon}
      title="Routine run"
      when={run && runHeader(run)}
      asked={routine && { label: 'The routine asked', text: routine.description }}
      gone={routines && !run ? 'This run is no longer in the routine’s list.' : undefined}
      close={() => void close()}
    />
  )
}
