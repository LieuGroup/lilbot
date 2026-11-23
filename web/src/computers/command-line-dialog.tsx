import { cn } from 'cn'
import { Dialog, DialogContent } from '@/ui/dialog'
import { ConnectedStep } from './add-step-end'
import { CommandLineRunStep } from './command-line-run'
import { CommandLineSetupStep, ExpiredCommandStep } from './command-line-setup'
import { useCommandLine } from './use-command-line'

/** "Add by command line": pick system and network, run the verified zero-secret command, paste the code at
 *  the hidden prompt, and watch the computer connect. The code exists only in state and drops on register/expire/close. */
export function CommandLineDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={next => !next && onClose()}>
      {open && <Body onClose={onClose} />}
    </Dialog>
  )
}

function Body({ onClose }: { onClose: () => void }) {
  const flow = useCommandLine()
  const compact = flow.phase === 'connected'
  return (
    <DialogContent
      showCloseButton={false}
      className={cn(
        'flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex-col gap-3.5 overflow-x-hidden overflow-y-auto rounded-2xl bg-card p-6',
        compact ? 'max-w-[400px] sm:max-w-[400px]' : 'max-w-[480px] sm:max-w-[480px]'
      )}
    >
      {flow.phase === 'setup' && (
        <CommandLineSetupStep
          info={flow.info}
          name={flow.name}
          onName={flow.setName}
          system={flow.system}
          onSystem={flow.setSystem}
          network={flow.network}
          onNetwork={flow.setNetwork}
          selectedDownload={flow.selectedDownload}
          busy={flow.busy}
          error={flow.error}
          onCreate={() => void flow.create()}
          onCancel={onClose}
        />
      )}
      {(flow.phase === 'waiting' || flow.phase === 'registered') && flow.attempt && (
        <CommandLineRunStep
          name={flow.name.trim()}
          system={flow.system}
          network={flow.network}
          attempt={flow.attempt}
          code={flow.secretCode}
          registered={flow.phase === 'registered'}
          left={flow.attempt.expiresAt - flow.now}
          onSwitchOutside={() => flow.setNetwork('outside')}
          onChange={flow.reset}
          onClose={onClose}
        />
      )}
      {flow.phase === 'connected' && (
        <ConnectedStep
          name={flow.status?.computer?.name ?? flow.name.trim()}
          computer={flow.status?.computer}
          machine={flow.system.os === 'macos' ? 'Mac' : 'computer'}
          tied={false}
          onDone={onClose}
        />
      )}
      {flow.phase === 'expired' && <ExpiredCommandStep onClose={onClose} onAgain={flow.reset} />}
    </DialogContent>
  )
}
