/** How a work item's result is marked everywhere it shows (Paper artboard 20, frame 2). */
import { CheckIcon, LoaderCircleIcon, XIcon } from 'lucide-react'
import type { WorkSummary } from '../../../shared/work-schema'
import { type ResultBadge, workBadge } from './work-lines'

const BASE = 'inline-flex flex-none items-center gap-1 rounded-full py-px text-xs/4 font-medium whitespace-nowrap'

/** Green appears only for work another bot (or fresh checker) verified or Oscar passed. */
export function CheckBadge({ item, kind }: { item?: Pick<WorkSummary, 'status' | 'checkLevel' | 'check'>; kind?: ResultBadge | null }) {
  const badge = kind !== undefined ? kind : item ? workBadge(item) : null
  if (!badge) return null
  switch (badge) {
    case 'verified':
      return (
        <span className={`${BASE} bg-success/12 pr-2 pl-1.5 text-success`}>
          <CheckIcon className="size-3" strokeWidth={2.6} aria-hidden />
          Verified
        </span>
      )
    case 'not_verified':
      return (
        <span className={`${BASE} bg-destructive/10 pr-2 pl-1.5 text-destructive`}>
          <XIcon className="size-3" strokeWidth={2.6} aria-hidden />
          Not verified
        </span>
      )
    case 'could_not_check':
      return <span className={`${BASE} px-2 text-destructive ring-1 ring-destructive/40`}>Could not check</span>
    case 'self_checked':
      return <span className={`${BASE} bg-foreground/6 px-2 text-foreground`}>Self-checked</span>
    case 'not_checked':
      return <span className={`${BASE} bg-foreground/6 px-2 text-muted-foreground`}>Not checked</span>
    case 'checking':
      return (
        <span className={`${BASE} bg-primary/12 pr-2 pl-1.5 text-primary`}>
          <LoaderCircleIcon className="size-3 animate-spin" strokeWidth={2.6} aria-hidden />
          Being checked
        </span>
      )
  }
}
