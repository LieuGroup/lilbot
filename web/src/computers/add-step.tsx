import { DownloadStep } from './add-step-download'
import { ConnectedStep, ExpiredStep, UnsupportedStep } from './add-step-end'
import { FallbackStep, WaitingStep } from './add-step-waiting'
import type { Detected } from './add-this-system'
import { buildLabel, machineWord } from './add-this-system'
import { saveFile, type useAddAttempt } from './use-add-attempt'

interface Props {
  attempt: ReturnType<typeof useAddAttempt>
  detected: Detected
  supported: boolean
  olderMacVersion?: string
  name: string
  onName: (name: string) => void
  onClose: () => void
  onCommandLine: () => void
}

/** The screen for the attempt's phase. */
export function AddStep({ attempt, detected, supported, olderMacVersion, name, onName, onClose, onCommandLine }: Props) {
  const { phase, secret, status } = attempt
  const machine = machineWord(detected.system)
  if (!supported) return <UnsupportedStep device={detected.device} unavailable={false} onCommandLine={onCommandLine} onClose={onClose} />
  if (phase === 'unsupported' || phase === 'unavailable')
    return <UnsupportedStep device={detected.device} unavailable={phase === 'unavailable'} onCommandLine={onCommandLine} onClose={onClose} />
  if (phase === 'connected') return <ConnectedStep name={status?.computer?.name ?? name} computer={status?.computer} machine={machine} onDone={onClose} />
  if (phase === 'expired') return <ExpiredStep onClose={onClose} onAgain={attempt.reset} />
  const { attempt: running } = attempt
  if (phase === 'name' || !running)
    return (
      <DownloadStep
        name={name}
        onName={onName}
        machine={machine}
        build={buildLabel(detected.system)}
        olderMacVersion={olderMacVersion}
        busy={attempt.busy}
        error={attempt.error}
        onDownload={() => void attempt.begin()}
        onCommandLine={onCommandLine}
        onCancel={onClose}
      />
    )
  const shared = { download: running.download, machine, left: running.expiresAt - attempt.now, onDownloadAgain: () => saveFile(running.download.url), onCancel: onClose }
  if (phase === 'fallback' && secret) return <FallbackStep {...shared} code={secret.code} link={secret.link} />
  return <WaitingStep {...shared} registered={phase === 'registered'} />
}
