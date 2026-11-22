import { cn } from 'cn'
import type { RefObject } from 'react'

import { Popover, PopoverContent } from '@/ui/popover'
import { Progress } from '@/ui/progress'
import type { BotContext } from '../../../shared/bot-schema'
import { contextDetailView } from './usage-format'
import { BottomSheet, useWideScreen } from './usage-sheet'

interface ContextPopoverProps {
  botName: string
  context?: BotContext
  open: boolean
  onOpenChange: (open: boolean) => void
  anchor: RefObject<HTMLButtonElement | null>
  onHoverEnter: () => void
  onHoverLeave: () => void
}

function ContextBody({ botName, context, sheet }: { botName: string; context?: BotContext; sheet: boolean }) {
  const view = contextDetailView(context)
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className={sheet ? 'text-base/5 font-semibold text-foreground' : 'text-[13px]/4 font-semibold text-foreground'}>Context</span>
        {view.percentLabel && <span className="text-xs text-muted-foreground tabular-nums">{view.percentLabel}</span>}
      </div>
      {view.barValue !== null && <Progress value={view.barValue} aria-label="Context used" />}
      <div className={cn('tabular-nums', sheet ? 'text-sm/[18px]' : 'text-[13px]/4', view.empty ? 'text-muted-foreground' : 'text-foreground')}>{view.countLine}</div>
      <p className="text-xs/[17px] text-muted-foreground">What {botName} carries into its next reply. The engine shortens a long conversation by itself; a line marks where.</p>
    </>
  )
}

/** Exact context count opened from the composer meter on hover or tap (Paper artboard 21, frames 2 and 6). Loaded lazily on first use. */
export default function ContextPopover({ botName, context, open, onOpenChange, anchor, onHoverEnter, onHoverLeave }: ContextPopoverProps) {
  const wide = useWideScreen()
  if (!wide) {
    return (
      <BottomSheet open={open} onOpenChange={onOpenChange} title="Context">
        <ContextBody botName={botName} context={context} sheet />
      </BottomSheet>
    )
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverContent anchor={anchor} side="top" align="start" sideOffset={8} onPointerEnter={onHoverEnter} onPointerLeave={onHoverLeave} className="w-[300px] gap-2.5">
        <ContextBody botName={botName} context={context} sheet={false} />
      </PopoverContent>
    </Popover>
  )
}
