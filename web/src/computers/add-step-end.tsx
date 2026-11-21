import { useEffect, useState } from 'react'
import { Button } from '@/ui/button'
import { Notice } from '@/ui/notice'
import { Switch } from '@/ui/switch'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { Badge, CancelButton, Footer, Heading, QuietLink, TEXT_BUTTON } from './add-dialog-parts'
import { useComputers } from './use-computers'

function useMainChoice(computerId: string | undefined) {
  const { computers } = useComputers()
  const [choice, setChoice] = useState<{ previous: string | null; on: boolean } | null>(null)
  const [error, setError] = useState('')

  const apply = (computer: string | null) => {
    setError('')
    lilbot.call('computers.setMain', { computer }).catch(failure => setError(messageOf(failure)))
  }

  useEffect(() => {
    if (!computers || !computerId || choice) return
    const previous = computers.find(computer => computer.main)?.id ?? null
    setChoice({ previous, on: previous === null || previous === computerId })
    if (previous === null) apply(computerId)
  }, [computers, computerId, choice])

  const toggle = (on: boolean) => {
    if (!choice || !computerId) return
    setChoice({ ...choice, on })
    apply(on ? computerId : choice.previous === computerId ? null : choice.previous)
  }
  return { on: choice?.on ?? false, ready: choice !== null, error, toggle }
}

/** Step 3: the computer is online, and this browser is tied to it. */
export function ConnectedStep({ name, computerId, machine, onDone }: { name: string; computerId?: string; machine: string; onDone: () => void }) {
  const main = useMainChoice(computerId)
  return (
    <>
      <Badge tone="success" />
      <Heading title={`${name} is connected`}>Every bot can use it now. This browser is tied to it, so "my computer" written from here means this {machine}.</Heading>
      <div className="flex items-center justify-between gap-3 rounded-lg bg-background py-2.5 pr-3 pl-3.5">
        <div className="flex flex-col">
          <span id="make-main" className="text-[13px]/[18px] font-medium">
            Make it my main computer
          </span>
          <span className="text-xs text-muted-foreground">Used when you write from your phone</span>
        </div>
        <Switch aria-labelledby="make-main" checked={main.on} disabled={!main.ready} onCheckedChange={main.toggle} />
      </div>
      {main.error && <Notice tone="error">{main.error}</Notice>}
      <Footer>
        <Button className={TEXT_BUTTON} onClick={onDone}>
          Done
        </Button>
      </Footer>
    </>
  )
}

/** The attempt ran out after 10 minutes. */
export function ExpiredStep({ onClose, onAgain }: { onClose: () => void; onAgain: () => void }) {
  return (
    <>
      <Badge tone="quiet" />
      <Heading title="This attempt ran out">Adding a computer has to finish within 10 minutes. Nothing was added. If the installer is still open, close it first.</Heading>
      <Footer>
        <CancelButton onClick={onClose} label="Close" />
        <Button className={TEXT_BUTTON} onClick={onAgain}>
          Start again
        </Button>
      </Footer>
    </>
  )
}

/** This device (or this LilBot) cannot add a computer from the browser. */
export function UnsupportedStep(props: { device: string; unavailable: boolean; onCommandLine: () => void; onClose: () => void }) {
  return (
    <>
      {props.unavailable ? (
        <Heading title="Not ready yet">This LilBot has no installer for this computer yet. A machine can still be added by command line.</Heading>
      ) : (
        <>
          <Heading title="This device can't be added">The helper runs on macOS and Linux.{props.device && ` This looks like ${props.device}.`}</Heading>
          <div className="flex flex-col gap-0.5 rounded-xl bg-background px-3.5 py-3">
            <span className="text-[13px]/[18px] font-medium">To add a Mac</span>
            <span className="text-xs text-muted-foreground">Open LilBot in a browser on that Mac and choose “Add this computer”.</span>
          </div>
        </>
      )}
      <Footer left={<QuietLink onClick={props.onCommandLine}>Add by command line instead</QuietLink>}>
        <CancelButton onClick={props.onClose} label="Close" />
      </Footer>
    </>
  )
}
