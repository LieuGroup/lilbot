import { DownloadIcon, InfoIcon } from 'lucide-react'
import type { FormEvent } from 'react'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Label } from '@/ui/label'
import { Notice } from '@/ui/notice'
import { CancelButton, Footer, Heading, QuietLink, TEXT_BUTTON } from './add-dialog-parts'

/** Step 1: name the machine and download the installer. Nothing is minted until Download. */
export function DownloadStep(props: {
  name: string
  onName: (name: string) => void
  machine: string
  build: string
  olderMacVersion?: string
  busy: boolean
  error: string
  onDownload: () => void
  onCommandLine: () => void
  onCancel: () => void
}) {
  const ready = props.name.trim() !== '' && !props.busy
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (ready) props.onDownload()
  }
  return (
    <form className="contents" onSubmit={submit}>
      <Heading title="Add this computer">Your bots will be able to use files and the terminal on this {props.machine}.</Heading>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="computer-name" className="text-xs font-normal text-muted-foreground">
          Name
        </Label>
        <Input id="computer-name" maxLength={100} value={props.name} onChange={event => props.onName(event.target.value)} className="h-9 rounded-[10px] px-3 text-sm" />
      </div>
      {props.olderMacVersion && (
        <div className="flex items-start gap-2.5 rounded-[10px] bg-background px-3.5 py-3 ring-1 ring-hairline">
          <InfoIcon className="mt-0.5 size-4 flex-none stroke-[1.75] text-foreground" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[13px]/[18px] font-medium">This Mac app is an older build (v{props.olderMacVersion})</span>
            <span className="text-xs/[17px] text-muted-foreground">
              It gives bots files and terminal access, but cannot host coding workers yet. To host coding workers on this Mac now, add it by command line instead.
            </span>
            <div className="pt-0.5">
              <QuietLink onClick={props.onCommandLine}>Add by command line instead</QuietLink>
            </div>
          </div>
        </div>
      )}
      {props.error && <Notice tone="error">{props.error}</Notice>}
      <Footer left={props.build}>
        <CancelButton onClick={props.onCancel} />
        <Button type="submit" disabled={!ready} className={`${TEXT_BUTTON} gap-1.5 pr-3.5 pl-3`}>
          <DownloadIcon className="size-3.5 stroke-2" />
          Download
        </Button>
      </Footer>
    </form>
  )
}
