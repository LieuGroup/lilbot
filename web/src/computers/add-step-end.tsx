import { Button } from '@/ui/button'
import { Badge, CancelButton, Footer, Heading, QuietLink, TEXT_BUTTON } from './add-dialog-parts'

/** Step 3: the computer is online. */
export function ConnectedStep({ name, machine, onDone }: { name: string; machine: string; onDone: () => void }) {
  return (
    <>
      <Badge tone="success" />
      <Heading title={`${name} is connected`}>Every bot can use it now. The helper starts by itself when this {machine} starts.</Heading>
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
