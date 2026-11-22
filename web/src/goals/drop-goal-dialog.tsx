/** Confirmation dialog for dropping a goal with an optional reason (Paper artboard 20, frame 9). */
import { useState } from 'react'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog'
import { Input } from '@/ui/input'
import { Notice } from '@/ui/notice'
import { messageOf } from '../app/lilbot-socket'

export function DropGoalDialog({ text, onConfirm, onClose }: { text: string; onConfirm: (reason?: string) => Promise<void>; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [dropping, setDropping] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (dropping) return
    setDropping(true)
    setError('')
    try {
      await onConfirm(reason.trim() || undefined)
    } catch (failure) {
      setError(messageOf(failure))
      setDropping(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent showCloseButton={false} className="w-[calc(100%-2rem)] max-w-[432px] gap-4 rounded-2xl bg-card p-6 sm:max-w-[432px]">
        <div className="flex flex-col gap-1.5">
          <DialogTitle className="text-base/[22px] font-semibold tracking-[-0.01em]">Drop this goal?</DialogTitle>
          <DialogDescription className="text-[13px]/5 text-muted-foreground">
            “{text}” will end, its review routine will stop, and its unfinished work items will be dropped. Past reviews and records stay.
          </DialogDescription>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Input
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Reason (optional)"
            aria-label="Reason for dropping"
            disabled={dropping}
            autoFocus
            className="h-9 rounded-lg text-[13px]/[18px]"
          />
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" className="h-8 rounded-lg px-3 text-[13px]/[18px] font-medium" disabled={dropping} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={dropping} className="h-8 rounded-lg bg-destructive px-3.5 text-[13px]/[18px] font-medium text-white hover:bg-destructive/90">
              {dropping ? 'Dropping...' : 'Drop goal'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
