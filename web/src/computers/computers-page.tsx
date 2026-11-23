import { useState } from 'react'
import { Notice } from '@/ui/notice'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { useNow } from '../app/use-now'
import { ThisDeviceCard } from '../devices/this-device-card'
import { useThisDevice } from '../devices/use-this-device'
import { CommandLineDialog } from './command-line-dialog'
import { ComputerRow } from './computer-row'
import { computerRows } from './computer-rows'
import { RemoveComputerDialog } from './remove-computer-dialog'
import { useComputers } from './use-computers'

/** Settings > Computers: this device, every machine the bots can use, live, and the way to add one without a screen. */
export default function ComputersPage() {
  const { computers, error } = useComputers()
  const thisDevice = useThisDevice()
  const now = useNow(30_000)
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null)
  const [commandLine, setCommandLine] = useState(false)
  const [mainError, setMainError] = useState('')
  const rows = computers ? computerRows(computers, now, thisDevice.device?.computerId) : []
  const makeMain = (computer: string) => {
    setMainError('')
    lilbot.call('computers.setMain', { computer }).catch(failure => setMainError(messageOf(failure)))
  }
  return (
    <>
      <ThisDeviceCard state={thisDevice} computers={computers ?? []} />
      <section aria-labelledby="computers-list" className="flex flex-col gap-3.5">
        <h3 id="computers-list" className="pt-1.5 text-xs text-muted-foreground">
          Computers
        </h3>
        {error && <Notice tone="error">{error}</Notice>}
        {mainError && <Notice tone="error">{mainError}</Notice>}
        {computers && (
          <ul className="flex flex-col divide-y divide-hairline rounded-lg bg-background">
            {rows.map(row => (
              <ComputerRow key={row.id} row={row} onMakeMain={() => makeMain(row.id)} onRemove={() => setRemoving({ id: row.id, name: row.name })} />
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Every bot can use every computer here. Computers marked “Coding workers” can run coding tasks on their own. The main computer is used when you write from a phone, or from
          a device that is not one of these.
        </p>
      </section>
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
