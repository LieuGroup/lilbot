import { cn } from 'cn'
import { InfoIcon } from 'lucide-react'
import type { FormEvent } from 'react'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Label } from '@/ui/label'
import { Notice } from '@/ui/notice'
import type { CommandLineSystem, ComputerDownloadsInfo, HelperDownload } from '../../../shared/computer-add-schema'
import { Badge, CancelButton, Footer, Heading, TEXT_BUTTON } from './add-dialog-parts'
import { SYSTEM_OPTIONS, systemLabel } from './command-line-script'
import type { CommandLineNetwork } from './use-command-line'

export function CommandLineSetupStep(props: {
  info: ComputerDownloadsInfo | null
  name: string
  onName: (name: string) => void
  system: CommandLineSystem
  onSystem: (system: CommandLineSystem) => void
  network: CommandLineNetwork
  onNetwork: (network: CommandLineNetwork) => void
  selectedDownload?: HelperDownload
  busy: boolean
  error: string
  onCreate: () => void
  onCancel: () => void
}) {
  const hasPrivate = Boolean(props.info?.privateOrigin)
  const missingDoor = props.info !== null && !props.info.helperUrl
  const missingBuild = props.info !== null && !props.selectedDownload
  const ready = props.name.trim() !== '' && !props.busy && !missingDoor && !missingBuild
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (ready) props.onCreate()
  }
  return (
    <form className="contents" onSubmit={submit}>
      <Heading title="Add by command line">For a machine you reach by terminal or SSH. Nothing is created until you press Create command.</Heading>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cli-computer-name" className="text-xs font-normal text-muted-foreground">
          Name
        </Label>
        <Input
          id="cli-computer-name"
          placeholder="Build server"
          maxLength={100}
          value={props.name}
          disabled={props.busy}
          onChange={event => props.onName(event.target.value)}
          className="h-9 rounded-[10px] px-3 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">System</span>
        <div className="grid grid-cols-2 gap-1 rounded-[10px] bg-background p-1">
          {SYSTEM_OPTIONS.map(option => {
            const active = option.os === props.system.os && option.arch === props.system.arch
            return (
              <button
                key={`${option.os}-${option.arch}`}
                type="button"
                aria-pressed={active}
                onClick={() => props.onSystem({ os: option.os, arch: option.arch })}
                className={cn(
                  'min-h-8 rounded-[7px] px-2.5 py-1.5 text-[13px]/[18px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                  active ? 'bg-card font-medium text-foreground shadow-xs ring-1 ring-hairline' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">How that machine reaches LilBot</span>
        <div className="flex flex-col divide-y divide-hairline overflow-hidden rounded-xl bg-background">
          <NetworkOption
            selected={props.network === 'private'}
            disabled={!hasPrivate}
            title="On your private network (Tailscale)"
            description={
              hasPrivate
                ? 'One command downloads the helper directly from this LilBot and checks its checksum before running.'
                : 'No private network address is set up on this LilBot. Use the download option below.'
            }
            onSelect={() => props.onNetwork('private')}
          />
          <NetworkOption
            selected={props.network === 'outside'}
            disabled={false}
            title="Outside your private network"
            description="Download the installer here, copy it to the machine, and run the verified local command."
            onSelect={() => props.onNetwork('outside')}
          />
        </div>
      </div>
      <div className="flex items-start gap-2 rounded-[10px] bg-background px-3 py-2.5">
        <InfoIcon className="mt-0.5 size-3.5 flex-none stroke-[1.75] text-muted-foreground" />
        <p className="text-xs/[17px] text-muted-foreground">
          To run coding workers on this computer, install a coding engine on it (for example, Claude Code) and sign in there. Files and terminal work without it.
        </p>
      </div>
      {missingDoor && <Notice tone="error">This LilBot has no helper address set up, so it cannot create a command. Set LILBOT_HELPER_URL first.</Notice>}
      {!missingDoor && missingBuild && (
        <Notice tone="error">No command-line helper archive is built for {systemLabel(props.system)} yet. Build the helper downloads on the server first.</Notice>
      )}
      {props.error && <Notice tone="error">{props.error}</Notice>}
      <Footer>
        <CancelButton onClick={props.onCancel} />
        <Button type="submit" disabled={!ready} className={TEXT_BUTTON}>
          {props.busy ? 'Creating...' : 'Create command'}
        </Button>
      </Footer>
    </form>
  )
}

function NetworkOption(props: { selected: boolean; disabled: boolean; title: string; description: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      disabled={props.disabled}
      onClick={props.onSelect}
      className={cn(
        'flex items-start gap-2.5 px-3 py-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50',
        props.selected ? 'bg-foreground/4' : 'hover:bg-foreground/4'
      )}
    >
      <span
        aria-hidden
        className={cn('mt-0.5 flex size-4 flex-none items-center justify-center rounded-full', props.selected ? 'bg-foreground' : 'bg-card ring-1 ring-foreground/20')}
      >
        {props.selected && <span className="size-1.5 rounded-full bg-card" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px]/[18px] font-medium text-foreground">{props.title}</span>
        <span className="text-xs/4 text-muted-foreground">{props.description}</span>
      </span>
    </button>
  )
}

export function ExpiredCommandStep({ onClose, onAgain }: { onClose: () => void; onAgain: () => void }) {
  return (
    <>
      <Badge tone="quiet" />
      <Heading title="This command ran out">One-time codes expire after 10 minutes and are cleared from this page. Nothing was added to LilBot.</Heading>
      <Footer>
        <CancelButton onClick={onClose} label="Close" />
        <Button className={TEXT_BUTTON} onClick={onAgain}>
          Create a new command
        </Button>
      </Footer>
    </>
  )
}
