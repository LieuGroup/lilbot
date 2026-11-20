import { PlusIcon } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { Button } from '@/ui/button'
import { CommandLineDialog } from './command-line-dialog'

const AddComputerDialog = lazy(() => import('./add-computer-dialog'))

/** "Add this computer", top right of the page: opens the browser flow, which can hand over to "Add by command line". */
export default function AddComputerButton() {
  const [dialog, setDialog] = useState<'add' | 'command-line' | null>(null)
  return (
    <>
      <Button className="-my-0.5 h-[30px] gap-1.5 rounded-lg pr-3 pl-2.5 text-[13px]/[18px] font-medium" onClick={() => setDialog('add')}>
        <PlusIcon className="size-3.5 stroke-2" />
        Add this computer
      </Button>
      {dialog === 'add' && (
        <Suspense>
          <AddComputerDialog onClose={() => setDialog(null)} onCommandLine={() => setDialog('command-line')} />
        </Suspense>
      )}
      <CommandLineDialog open={dialog === 'command-line'} onClose={() => setDialog(null)} />
    </>
  )
}
