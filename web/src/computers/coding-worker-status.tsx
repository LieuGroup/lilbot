import { CheckIcon, InfoIcon } from 'lucide-react'
import type { Computer } from '../../../shared/computer-schema'
import { formatEngineWithVersion, hasCodingWorkers, partitionEngines, type ReportedCodingEngine } from './coding-engines'

function formatWithSignIn(engine: ReportedCodingEngine): string {
  const label = formatEngineWithVersion(engine)
  return engine.signedIn === false ? `${label} (not signed in)` : label
}

function signInHint(supported: ReportedCodingEngine[]): string | null {
  if (supported.length === 0) return 'Make sure it is signed in there so bots can run coding tasks.'
  if (supported.some(engine => engine.signedIn === false)) return 'Sign in to the coding engine on this computer so bots can run coding tasks.'
  if (supported.every(engine => engine.signedIn === true)) return null
  return `Make sure ${supported.length === 1 ? 'it is' : 'they are'} signed in on this computer so bots can run coding tasks.`
}

/** Shows whether a newly connected computer can host coding workers, listing every detected coding engine. */
export function CodingWorkerStatus({ computer }: { computer?: Computer }) {
  const ready = hasCodingWorkers(computer)
  const { supported, unsupported } = partitionEngines(computer)
  if (ready) {
    const hint = signInHint(supported)
    return (
      <div className="flex items-start gap-2.5 rounded-xl bg-background px-3.5 py-3">
        <div className="mt-0.5 flex size-5 flex-none items-center justify-center rounded-full bg-success/12 text-success">
          <CheckIcon className="size-3 stroke-[2.5]" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[13px]/[18px] font-medium">Ready for coding workers</span>
          <span className="text-xs/[17px] text-muted-foreground">
            {supported.length ? `Coding engines found: ${supported.map(formatWithSignIn).join(', ')}.` : 'A coding engine was found on this computer.'}
            {hint ? ` ${hint}` : ''}
          </span>
          {unsupported.length > 0 && (
            <span className="text-xs/[17px] text-muted-foreground">Also found, not supported yet: {unsupported.map(formatEngineWithVersion).join(', ')}.</span>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-background px-3.5 py-3 ring-1 ring-hairline">
      <div className="mt-0.5 flex size-5 flex-none items-center justify-center rounded-full bg-foreground/8 text-foreground">
        <InfoIcon className="size-3 stroke-[2.2]" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[13px]/[18px] font-medium">Can&apos;t host coding workers yet</span>
        <span className="text-xs/[17px] text-muted-foreground">
          {unsupported.length > 0
            ? `Found, not supported yet: ${unsupported.map(formatEngineWithVersion).join(', ')}. Install a supported coding engine (for example, Claude Code) and sign in there. LilBot checks again every 5 minutes.`
            : 'No coding engine found on this computer. Install a coding engine (for example, Claude Code) and sign in there. LilBot checks again every 5 minutes.'}
        </span>
      </div>
    </div>
  )
}
