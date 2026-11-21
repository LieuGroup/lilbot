import type { Routine } from '../../../shared/routine-schema'
import { ConfirmDeleteDialog } from './confirm-delete-dialog'
import { useRoutineNavigation } from './open-routine'
import { deleteRoutine } from './routine-store'

/** "Delete this routine?": it no longer runs and leaves the list with its runs. Back to the list after. */
export function DeleteRoutineDialog({ botId, routine, onClose }: { botId: string; routine: Routine; onClose: () => void }) {
  const { close } = useRoutineNavigation()
  const confirm = async () => {
    await deleteRoutine(botId, routine.id)
    onClose()
    await close()
  }
  return (
    <ConfirmDeleteDialog title="Delete this routine?" action="Delete routine" confirm={confirm} onClose={onClose}>
      “{routine.description.length > 120 ? `${routine.description.slice(0, 120)}…` : routine.description}” no longer runs, and it leaves this list with its runs. A run already
      under way finishes. This cannot be undone.
    </ConfirmDeleteDialog>
  )
}
