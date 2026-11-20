import { LoaderCircleIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/ui/button'
import type { HelperDownload } from '../../../shared/computer-add-schema'
import { CancelButton, Footer, Heading, QuietLink, TEXT_BUTTON } from './add-dialog-parts'
import { installerSteps } from './add-this-system'
import { countdown } from './computer-rows'

interface Props {
  download: HelperDownload
  machine: string
  left: number
  onDownloadAgain: () => void
  onCancel: () => void
}

/** Step 2: the installer is downloaded; wait for the helper to open and register. */
export function WaitingStep({ registered, ...props }: Props & { registered: boolean }) {
  const { verb, file, rest } = installerSteps(props.download)
  return (
    <>
      <Heading title="Open the installer">
        {registered ? (
          'The helper registered and is starting.'
        ) : (
          <>
            {verb} <span className="font-medium text-foreground">{file}</span> {rest} Keep this page open.
          </>
        )}
      </Heading>
      <div className="flex items-center gap-2.5 rounded-xl bg-background px-3.5 py-3" role="status">
        <LoaderCircleIcon className="size-3.5 flex-none animate-spin stroke-[2.5] text-primary" />
        <span className="flex-1 text-[13px]/[18px]">{registered ? 'Starting the helper…' : `Waiting for the helper on this ${props.machine}`}</span>
        {!registered && <span className="text-xs text-muted-foreground tabular-nums">{countdown(props.left)}</span>}
      </div>
      <Footer left={!registered && <QuietLink onClick={props.onDownloadAgain}>Download again</QuietLink>}>
        <CancelButton onClick={props.onCancel} />
      </Footer>
    </>
  )
}

/** The helper was not detected after about 30 seconds: the link and the short code to paste. The only place a code shows. */
export function FallbackStep({ code, link, ...props }: Props & { code: string; link: string }) {
  const [copied, setCopied] = useState('')
  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied('Copied')
    } catch {
      setCopied('Could not copy')
    }
    setTimeout(() => setCopied(''), 2000)
  }
  return (
    <>
      <Heading title="Still waiting for the helper">If the installer is open and asking for a code, paste this line into it.</Heading>
      <div className="flex items-center gap-2.5 rounded-[10px] bg-background p-3">
        <code className="flex-1 font-mono text-sm/5 tracking-[0.04em] break-all">{code}</code>
        <button
          type="button"
          onClick={copy}
          className="flex-none rounded-[6px] bg-card px-2 py-1 text-xs font-medium ring-1 ring-foreground/12 outline-none hover:bg-foreground/4 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {copied || 'Copy'}
        </button>
      </div>
      {props.download.link && (
        <Button variant="outline" className={TEXT_BUTTON} onClick={() => location.assign(link)}>
          Open LilBot Helper
        </Button>
      )}
      <p className="text-xs text-muted-foreground">Not open? Find {props.download.fileName} in your downloads, or download it again.</p>
      <Footer left={`Valid for ${countdown(props.left)} more`}>
        <CancelButton onClick={props.onCancel} />
        <Button variant="outline" className={TEXT_BUTTON} onClick={props.onDownloadAgain}>
          Download again
        </Button>
      </Footer>
    </>
  )
}
