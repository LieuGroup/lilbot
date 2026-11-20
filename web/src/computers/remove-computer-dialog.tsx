import { useState } from 'react'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog'
import { Notice } from '@/ui/notice'
import { lilbot, messageOf } from '../app/lilbot-socket'

/** "Remove <name>?": the bots lose it and its helper takes itself off the machine. */
export function RemoveComputerDialog({ computer, onClose }: { computer: { id: string; name: string } | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const close = () => {
    setError('')
    onClose()
  }
  async function remove() {
    if (!computer) return
    setBusy(true)
    setError('')
    try {
      await lilbot.call('computers.remove', { computer: computer.id })
      close()
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={computer !== null} onOpenChange={next => !next && !busy && close()}>
      <DialogContent showCloseButton={false} className="w-[calc(100%-2rem)] max-w-[432px] gap-5 rounded-2xl bg-card p-6 sm:max-w-[432px]">
        <div className="flex flex-col gap-1.5">
          <DialogTitle className="text-base/[22px] font-semibold tracking-[-0.01em]">Remove {computer?.name}?</DialogTitle>
          <DialogDescription className="text-[13px]/5 text-muted-foreground">
            Your bots can no longer use it. Its helper removes itself the next time it connects. To use the machine again, add it again.
          </DialogDescription>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" className="h-8 rounded-lg px-3 text-[13px]/[18px] font-medium" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button className="h-8 rounded-lg bg-destructive px-3 text-[13px]/[18px] font-medium text-white hover:bg-destructive/90" disabled={busy} onClick={remove}>
            {busy ? 'Removing...' : 'Remove'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
