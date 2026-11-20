import { DownloadIcon } from 'lucide-react'
import type { FormEvent } from 'react'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Label } from '@/ui/label'
import { Notice } from '@/ui/notice'
import { CancelButton, Footer, Heading, TEXT_BUTTON } from './add-dialog-parts'

/** Step 1: name the machine and download the installer. Nothing is minted until Download. */
export function DownloadStep(props: {
  name: string
  onName: (name: string) => void
  machine: string
  build: string
  busy: boolean
  error: string
  onDownload: () => void
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
