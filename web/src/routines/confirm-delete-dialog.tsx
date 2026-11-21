import { type ReactNode, useState } from 'react'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog'
import { Notice } from '@/ui/notice'
import { messageOf } from '../app/lilbot-socket'

const footButton = 'h-8 rounded-lg px-3 text-[13px]/[18px] font-medium'

/** "Delete this ...?" in the delete-bot dialog's style: a title, what deleting does, Cancel and a red button. A refusal
 *  stays in the dialog with the server's words; `confirm` closes it on success. */
export function ConfirmDeleteDialog({
  title,
  action,
  confirm,
  onClose,
  children
}: {
  title: string
  action: string
  confirm: () => Promise<void>
  onClose: () => void
  children: ReactNode
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  async function run() {
    setDeleting(true)
    setError('')
    try {
      await confirm()
    } catch (failure) {
      setError(messageOf(failure))
      setDeleting(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent showCloseButton={false} className="w-[calc(100%-2rem)] max-w-[432px] gap-5 rounded-2xl bg-card p-6 sm:max-w-[432px]">
        <div className="flex flex-col gap-1.5">
          <DialogTitle className="text-base/[22px] font-semibold tracking-[-0.01em]">{title}</DialogTitle>
          <DialogDescription className="text-[13px]/5 text-muted-foreground">{children}</DialogDescription>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" className={footButton} disabled={deleting} onClick={onClose}>
            Cancel
          </Button>
          <Button className={`${footButton} bg-destructive px-3.5 text-white hover:bg-destructive/90`} disabled={deleting} onClick={run}>
            {deleting ? 'Deleting...' : action}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
