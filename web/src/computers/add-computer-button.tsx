import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog'

/** "Add this computer", top right of the page. Until the browser flow exists it opens a note. */
export default function AddComputerButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button className="-my-0.5 h-[30px] gap-1.5 rounded-lg pr-3 pl-2.5 text-[13px]/[18px] font-medium" onClick={() => setOpen(true)}>
        <PlusIcon className="size-3.5 stroke-2" />
        Add this computer
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="w-[calc(100%-2rem)] max-w-[432px] gap-5 rounded-2xl bg-card p-6 sm:max-w-[432px]">
          <div className="flex flex-col gap-1.5">
            <DialogTitle className="text-base/[22px] font-semibold tracking-[-0.01em]">Coming soon</DialogTitle>
            <DialogDescription className="text-[13px]/5 text-muted-foreground">
              Adding this computer from the browser is not ready yet. For now, use “Add a machine without a screen…” at the bottom of the list.
            </DialogDescription>
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" className="h-8 rounded-lg px-3 text-[13px]/[18px] font-medium" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
