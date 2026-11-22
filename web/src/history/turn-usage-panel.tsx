import { cn } from 'cn'
import type { RefObject } from 'react'

import { Popover, PopoverContent } from '@/ui/popover'
import type { TurnUsage } from '../../../shared/chat-schema'
import { turnUsageView, type UsageBucketKey } from './usage-format'
import { BottomSheet, useWideScreen } from './usage-sheet'

const BUCKET_TONE: Record<UsageBucketKey, string> = {
  cacheRead: 'bg-foreground/20',
  cacheWrite: 'bg-foreground/50',
  input: 'bg-foreground',
  output: 'bg-muted-foreground'
}

interface TurnUsagePanelProps {
  usage?: TurnUsage
  open: boolean
  onOpenChange: (open: boolean) => void
  anchor: RefObject<HTMLButtonElement | null>
}

function TurnUsageBody({ usage, sheet }: { usage?: TurnUsage; sheet: boolean }) {
  const view = turnUsageView(usage)
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className={sheet ? 'text-base/5 font-semibold text-foreground' : 'text-[13px]/4 font-semibold text-foreground'}>This turn</span>
        {view.totalLabel && <span className="text-xs text-muted-foreground tabular-nums">{view.totalLabel}</span>}
      </div>
      {view.empty ? (
        <p className="text-[13px]/[19px] text-muted-foreground">No numbers were recorded for this turn.</p>
      ) : (
        <>
          {view.hasBreakdown ? (
            <>
              {!sheet && view.segments.length > 0 && (
                <div className="flex h-1.5 shrink-0 gap-0.5" aria-hidden>
                  {view.segments.map(segment => (
                    <span key={segment.key} className={cn('h-1.5 rounded-[3px]', BUCKET_TONE[segment.key])} style={{ flexGrow: segment.value, flexBasis: 0, minWidth: '4px' }} />
                  ))}
                </div>
              )}
              <div className={sheet ? 'flex flex-col gap-2.5' : 'flex flex-col gap-2'}>
                {view.rows.map(row => (
                  <div key={row.key} className={cn('flex items-center', sheet ? 'justify-between gap-3 text-sm/[18px]' : 'gap-2 text-[13px]/4')}>
                    {!sheet && <span aria-hidden className={cn('size-2 shrink-0 rounded-[2px]', BUCKET_TONE[row.key])} />}
                    <span className={cn('flex-1', row.muted ? 'text-muted-foreground' : 'text-foreground')}>{row.label}</span>
                    <span className={cn('tabular-nums', row.muted ? 'text-muted-foreground' : 'text-foreground')}>{row.text}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-[13px]/[19px] text-muted-foreground">No numbers were recorded for this turn.</p>
          )}
          {view.contextAfter && (
            <>
              <hr className="h-px shrink-0 border-0 bg-hairline" />
              <div className="flex justify-between gap-3 text-xs text-muted-foreground tabular-nums">
                <span>Context after this turn</span>
                <span>{view.contextAfter}</span>
              </div>
            </>
          )}
        </>
      )}
    </>
  )
}

/** On-demand token and cache breakdown for one reply (Paper artboard 21, frames 1, 4, 5 and 6). Loaded lazily on first use. */
export default function TurnUsagePanel({ usage, open, onOpenChange, anchor }: TurnUsagePanelProps) {
  const wide = useWideScreen()
  const empty = turnUsageView(usage).empty
  if (!wide) {
    return (
      <BottomSheet open={open} onOpenChange={onOpenChange} title="This turn">
        <TurnUsageBody usage={usage} sheet />
      </BottomSheet>
    )
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverContent anchor={anchor} side="bottom" align="start" sideOffset={6} className={empty ? 'w-[280px] gap-2' : 'w-[300px] gap-3'}>
        <TurnUsageBody usage={usage} sheet={false} />
      </PopoverContent>
    </Popover>
  )
}
