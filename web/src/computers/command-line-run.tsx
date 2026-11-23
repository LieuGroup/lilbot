import { DownloadIcon, LoaderCircleIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/ui/button'
import { DialogDescription, DialogTitle } from '@/ui/dialog'
import { Notice } from '@/ui/notice'
import type { CommandLineSystem } from '../../../shared/computer-add-schema'
import { CancelButton, Footer, QuietLink, TEXT_BUTTON } from './add-dialog-parts'
import { buildOutsideCommand, buildPrivateCommand, formatBytes, installDetails, systemLabel } from './command-line-script'
import { countdown } from './computer-rows'
import { saveFile } from './use-add-attempt'
import type { CommandLineAttempt, CommandLineNetwork } from './use-command-line'

const COPY_BTN =
  'flex-none rounded-[6px] bg-card px-2 py-1 text-xs font-medium ring-1 ring-foreground/12 outline-none hover:bg-foreground/4 focus-visible:ring-3 focus-visible:ring-ring/50'

function useCopy(value: string | null) {
  const [label, setLabel] = useState('')
  const copy = async () => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setLabel('Copied')
    } catch {
      setLabel('Could not copy')
    }
    setTimeout(() => setLabel(''), 2000)
  }
  return { label, copy }
}

export function CommandLineRunStep(props: {
  name: string
  system: CommandLineSystem
  network: CommandLineNetwork
  attempt: CommandLineAttempt
  code: string | null
  registered: boolean
  left: number
  onSwitchOutside: () => void
  onChange: () => void
  onClose: () => void
}) {
  const { attempt, network, system, name } = props
  const download = attempt.download
  const command =
    download && attempt.helperUrl
      ? network === 'private' && attempt.privateOrigin
        ? buildPrivateCommand({ privateOrigin: attempt.privateOrigin, download, helperUrl: attempt.helperUrl })
        : buildOutsideCommand({ download, helperUrl: attempt.helperUrl })
      : null
  const cmdCopy = useCopy(command)
  const codeCopy = useCopy(props.code)
  const details = installDetails(system.os)
  const networkText = network === 'private' ? 'On your private network' : 'Outside your private network'

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <DialogTitle className="truncate text-base/[22px] font-semibold tracking-[-0.01em]">Add {name}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {systemLabel(system)} · {networkText}
          </DialogDescription>
        </div>
        <QuietLink onClick={props.onChange}>Change</QuietLink>
      </div>
      {!command && <Notice tone="error">This LilBot is missing the helper archive or address needed to build this command.</Notice>}
      {command && download && network === 'outside' && (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px]/[18px] font-medium">1. Download the installer here</span>
            <div className="flex items-center justify-between gap-3 rounded-[10px] bg-background px-3 py-2.5">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-mono text-xs font-medium">{download.fileName}</span>
                <span className="text-xs text-muted-foreground">
                  {formatBytes(download.size)} · v{download.version} · Uses this browser&apos;s session
                </span>
              </div>
              <Button type="button" className={`${TEXT_BUTTON} h-[30px] gap-1.5 px-2.5 text-xs`} onClick={() => saveFile(download.url)}>
                <DownloadIcon className="size-3.5 stroke-2" />
                Download
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[13px]/[18px] font-medium">2. Copy the file to {name}&apos;s home folder</span>
            <p className="text-xs/[17px] text-muted-foreground">
              For example: <code className="font-mono break-all text-foreground">scp ~/Downloads/{download.fileName} user@host:~/</code>
            </p>
          </div>
        </>
      )}
      {command && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px]/[18px] font-medium">
              {network === 'outside' ? '3' : '1'}. Run this on {name}
            </span>
            <button type="button" onClick={cmdCopy.copy} className={COPY_BTN}>
              {cmdCopy.label || 'Copy command'}
            </button>
          </div>
          <pre className="overflow-x-auto rounded-[10px] bg-background p-3 font-mono text-xs/[18px] whitespace-pre-wrap break-all">{command}</pre>
          {network === 'private' && <p className="text-xs text-muted-foreground">Checks the SHA-256 hash before unpacking. Contains no secret code.</p>}
        </div>
      )}
      {props.code && !props.registered && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px]/[18px] font-medium">{network === 'outside' ? '4' : '2'}. When asked for the code, paste only this</span>
          <div className="flex items-center gap-2.5 rounded-[10px] bg-background px-3 py-2.5">
            <code className="min-w-0 flex-1 font-mono text-xs/[18px] break-all">{props.code}</code>
            <button type="button" onClick={codeCopy.copy} className={COPY_BTN}>
              {codeCopy.label || 'Copy code'}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Single use. Stays hidden as you paste and never enters shell history.</p>
        </div>
      )}
      <div className="flex items-center gap-2.5 rounded-xl bg-background px-3.5 py-2.5" role="status">
        <LoaderCircleIcon className="size-3.5 flex-none animate-spin stroke-[2.5] text-primary" />
        <span className="flex-1 text-[13px]/[18px]">{props.registered ? 'Starting the helper…' : `Waiting for ${name} to connect`}</span>
        {!props.registered && <span className="text-xs text-muted-foreground tabular-nums">{countdown(props.left)}</span>}
      </div>
      <div className="flex flex-col gap-1.5 rounded-[10px] p-3 ring-1 ring-hairline">
        <span className="text-xs font-semibold">What this installs &amp; how to remove it</span>
        <p className="text-xs/[17px] text-muted-foreground">{details.summary}</p>
        <p className="text-xs/[17px] text-muted-foreground">{details.remove}</p>
      </div>
      <Footer
        left={
          network === 'private' && !props.registered ? (
            <QuietLink onClick={props.onSwitchOutside}>Not on your private network? Download file instead</QuietLink>
          ) : (
            `Valid for ${countdown(props.left)} more`
          )
        }
      >
        <CancelButton onClick={props.onClose} label="Close" />
      </Footer>
    </>
  )
}
