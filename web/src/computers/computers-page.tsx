import { useState } from 'react'
import { Notice } from '@/ui/notice'
import { useNow } from '../app/use-now'
import { CommandLineDialog } from './command-line-dialog'
import { ComputerRow } from './computer-row'
import { computerRows } from './computer-rows'
import { RemoveComputerDialog } from './remove-computer-dialog'
import { useComputers } from './use-computers'

/** Settings > Computers: every machine the bots can use, live, and the way to add one without a screen. */
export default function ComputersPage() {
  const { computers, error } = useComputers()
  const now = useNow(30_000)
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null)
  const [commandLine, setCommandLine] = useState(false)
  const rows = computers ? computerRows(computers, now) : []
  return (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      {computers && (
        <ul className="flex flex-col divide-y divide-hairline rounded-xl bg-background">
          {rows.map(row => (
            <ComputerRow key={row.id} row={row} onRemove={() => setRemoving({ id: row.id, name: row.name })} />
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Every bot can use every computer here. Offline machines pick up queued work when they wake.</p>
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => setCommandLine(true)}
        className="self-start rounded-sm text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Add a machine without a screen…
      </button>
      <RemoveComputerDialog computer={removing} onClose={() => setRemoving(null)} />
      <CommandLineDialog open={commandLine} onClose={() => setCommandLine(false)} />
    </>
  )
}
