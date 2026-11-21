import { useState } from 'react'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog'
import { Notice } from '@/ui/notice'
import type { Routine } from '../../../shared/routine-schema'
import { messageOf } from '../app/lilbot-socket'
import { useRoutineNavigation } from './open-routine'
import { deleteRoutine } from './routine-store'

const footButton = 'h-8 rounded-lg px-3 text-[13px]/[18px] font-medium'

/** "Delete this routine?", in the delete-bot dialog's style: it no longer runs and leaves the list with its runs. Back to
 *  the list after. */
export function DeleteRoutineDialog({ botId, routine, onClose }: { botId: string; routine: Routine; onClose: () => void }) {
  const { close } = useRoutineNavigation()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  async function confirm() {
    setDeleting(true)
    setError('')
    try {
      await deleteRoutine(botId, routine.id)
      onClose()
      await close()
    } catch (failure) {
      setError(messageOf(failure))
      setDeleting(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent showCloseButton={false} className="w-[calc(100%-2rem)] max-w-[432px] gap-5 rounded-2xl bg-card p-6 sm:max-w-[432px]">
        <div className="flex flex-col gap-1.5">
          <DialogTitle className="text-base/[22px] font-semibold tracking-[-0.01em]">Delete this routine?</DialogTitle>
          <DialogDescription className="text-[13px]/5 text-muted-foreground">
            “{routine.description.length > 120 ? `${routine.description.slice(0, 120)}…` : routine.description}” no longer runs, and it leaves this list with its runs. A run
            already under way finishes. This cannot be undone.
          </DialogDescription>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" className={footButton} disabled={deleting} onClick={onClose}>
            Cancel
          </Button>
          <Button className={`${footButton} bg-destructive px-3.5 text-white hover:bg-destructive/90`} disabled={deleting} onClick={confirm}>
            {deleting ? 'Deleting...' : 'Delete routine'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
