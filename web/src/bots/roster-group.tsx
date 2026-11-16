import { cn } from 'cn'
import { type ReactNode, useState } from 'react'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible'

const labelRow = 'flex h-[30px] flex-none items-center px-2 pt-2 text-xs text-muted-foreground'

/** A named section: a 12px label above its rows. */
export function RosterSection({ name, children }: { name: string; children: ReactNode }) {
  return (
    <li>
      <div className={labelRow}>{name}</div>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </li>
  )
}

function storedOpen(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'open'
  } catch {
    return false
  }
}

/** "Unassigned" and "Hidden": collapsed to a label and a count until opened. The group that
 *  holds the open bot stays open, so the selected row is always visible. */
export function RosterCollapsedGroup({
  id,
  name,
  count,
  holdsActive,
  tight,
  children
}: {
  id: string
  name: string
  count: number
  holdsActive: boolean
  tight?: boolean
  children: ReactNode
}) {
  const key = `lilbot.roster-open.${id}`
  const [open, setOpen] = useState(() => storedOpen(key))
  const toggle = (next: boolean) => {
    setOpen(next)
    try {
      localStorage.setItem(key, next ? 'open' : 'closed')
    } catch {
      // Not remembered in a private window; it stays as chosen until reload.
    }
  }
  return (
    <li>
      <Collapsible open={open || holdsActive} onOpenChange={toggle}>
        <CollapsibleTrigger
          className={cn(labelRow, 'w-full justify-between rounded-md outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50', tight && 'h-[26px] pt-1')}
        >
          <span>{name}</span>
          <span className="text-foreground/40 tabular-nums">{count}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="flex flex-col gap-0.5 pt-0.5">{children}</ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}
