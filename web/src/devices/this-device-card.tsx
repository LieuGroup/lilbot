import { type ReactNode, useEffect, useState } from 'react'
import { Input } from '@/ui/input'
import { Notice } from '@/ui/notice'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/ui/select'
import { deviceLine } from '../../../shared/client/devices/device-line'
import type { Computer } from '../../../shared/computer-schema'
import type { useThisDevice } from './use-this-device'

export { deviceLine }

const NONE = 'none'
const FIELD = 'h-[30px] w-50 min-w-0 rounded-[8px] border-0 bg-card text-[13px]/[18px] ring-1 ring-foreground/12 sm:w-55 md:text-[13px]/[18px]'

function Row({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="flex h-[46px] items-center justify-between gap-3 py-2 pr-2 pl-3.5">
      <label htmlFor={id} className="text-[13px]/[18px] sm:w-33 sm:flex-none">
        {label}
      </label>
      {children}
    </div>
  )
}

/** "This device" on Settings › Computers: its name, the computer it runs on, and what "my computer" means from here. */
export function ThisDeviceCard({ state, computers }: { state: ReturnType<typeof useThisDevice>; computers: Computer[] }) {
  const { device, error, rename, link } = state
  const [draft, setDraft] = useState('')
  useEffect(() => setDraft(device?.name ?? ''), [device?.name])
  const save = () => {
    const name = draft.trim()
    if (!device || name === device.name) return
    if (name) void rename(name)
    else setDraft(device.name)
  }
  const items = [...computers.map(computer => ({ value: computer.id, label: computer.name })), { value: NONE, label: 'Not one of these' }]
  return (
    <section aria-labelledby="this-device" className="flex flex-col gap-3.5">
      <h3 id="this-device" className="pt-0.5 text-xs text-muted-foreground">
        This device
      </h3>
      <div className="flex flex-col divide-y divide-hairline rounded-lg bg-background">
        <Row label="Name" id="device-name">
          <Input
            id="device-name"
            maxLength={100}
            value={draft}
            disabled={!device}
            onChange={event => setDraft(event.target.value)}
            onBlur={save}
            onKeyDown={event => event.key === 'Enter' && event.currentTarget.blur()}
            className={FIELD}
          />
        </Row>
        <Row label="Runs on" id="device-computer">
          <Select items={items} value={device?.computerId ?? NONE} disabled={!device} onValueChange={value => value && void link(value === NONE ? null : value)}>
            <SelectTrigger id="device-computer" className={`${FIELD} pr-2 pl-2.5 data-[size=default]:h-[30px]`}>
              <SelectValue className={device?.computerId ? 'truncate' : 'truncate text-muted-foreground'} />
            </SelectTrigger>
            <SelectContent className="rounded-lg p-1" alignItemWithTrigger={false}>
              {computers.map(computer => (
                <SelectItem key={computer.id} value={computer.id} className="h-[30px] px-2 text-[13px]/[18px]">
                  {computer.name}
                </SelectItem>
              ))}
              <SelectSeparator />
              <SelectItem value={NONE} className="h-[30px] px-2 text-[13px]/[18px] text-muted-foreground">
                Not one of these
              </SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </div>
      {device && <p className="text-xs text-muted-foreground">{deviceLine(device.resolves)}</p>}
      {error && <Notice tone="error">{error}</Notice>}
    </section>
  )
}
