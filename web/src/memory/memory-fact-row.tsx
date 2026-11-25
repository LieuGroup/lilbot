import { ChevronUpIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/ui/button'
import { originLine, removedLine, rowNote, seenLine } from '../../../shared/client/memory/memory-lines'
import type { MemoryFact } from '../../../shared/memory-schema'

export interface FactActions {
  forget: (fact: MemoryFact) => void
  pause: (fact: MemoryFact) => void
  restore: (fact: MemoryFact) => void
}

/** A rounded group of rows on the page's tinted ground, with hairlines between them. */
export function FactGroup({ children }: { children: ReactNode }) {
  return <ul className="flex flex-none flex-col overflow-hidden rounded-xl bg-background [&>li+li]:border-t [&>li+li]:border-hairline">{children}</ul>
}

interface RowProps {
  fact: MemoryFact
  now: number
  open: boolean
  botName: string
  /** The bot's badge before the text, where facts of several bots are mixed (search). */
  lead?: ReactNode
  busy: boolean
  actions: FactActions
  onToggle: () => void
}

/** One fact on one line; opened, the full text, where it came from, who sees it, and Pause or Forget. */
export function FactRow({ fact, now, open, botName, lead, busy, actions, onToggle }: RowProps) {
  const note = rowNote(fact, now)
  if (!open)
    return (
      <li>
        <button
          type="button"
          aria-expanded={false}
          onClick={onToggle}
          className="flex h-9 w-full items-center gap-2.5 pr-3 pl-3.5 text-left outline-none hover:bg-foreground/4 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
          {lead}
          <span className={`min-w-0 flex-1 truncate text-[13px]/[18px] ${note ? 'text-muted-foreground' : ''}`}>{fact.text}</span>
          {note && <span className="flex-none text-xs text-muted-foreground">{note}</span>}
        </button>
      </li>
    )
  return (
    <li className="p-1">
      <div className="flex flex-col gap-2.5 rounded-xl bg-card py-3 pr-3 pl-3.5 ring-1 ring-foreground/12 ring-inset">
        <button
          type="button"
          aria-expanded
          onClick={onToggle}
          className="flex items-start gap-2.5 rounded-sm text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="min-w-0 flex-1 text-[13px]/[19px] font-medium break-words">{fact.text}</span>
          <ChevronUpIcon className="mt-0.5 size-3.5 flex-none text-muted-foreground" />
        </button>
        <div className="flex flex-col text-xs text-muted-foreground">
          <span>{originLine(fact, botName)}</span>
          <span>{seenLine(fact, botName, now)}</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-7 bg-card text-[13px]" disabled={busy} onClick={() => actions.pause(fact)}>
            {fact.paused ? 'Resume' : 'Pause'}
          </Button>
          <Button variant="outline" size="sm" className="h-7 bg-card text-[13px] text-destructive hover:text-destructive" disabled={busy} onClick={() => actions.forget(fact)}>
            Forget
          </Button>
        </div>
      </div>
    </li>
  )
}

/** A removed fact: its text, who removed it and when, and Restore. */
export function RemovedRow({ fact, botName, busy, onRestore }: { fact: MemoryFact; botName: string; busy: boolean; onRestore: () => void }) {
  return (
    <li className="flex items-center gap-3 py-2 pr-2.5 pl-3.5">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px]/[18px]">{fact.text}</span>
        <span className="text-xs text-muted-foreground">{removedLine(fact, botName)}</span>
      </div>
      <Button variant="outline" size="sm" className="h-7 bg-card text-[13px]" disabled={busy} onClick={onRestore}>
        Restore
      </Button>
    </li>
  )
}
