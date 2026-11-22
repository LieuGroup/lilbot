import { cn } from 'cn'
import { lazy, type PointerEvent, Suspense, useEffect, useRef, useState } from 'react'

import { useBotStore } from '../bots/bot-store'
import { contextMeterView } from './usage-format'
import { contextMeterOnClick, type TriggerState } from './usage-trigger'

const loadPopover = () => import('./context-popover')
const ContextPopover = lazy(loadPopover)
const RING_CIRCUMFERENCE = 2 * Math.PI * 6

/** Small context meter pill beside the model picker in the composer (Paper artboard 21, frames 2 and 5).
 *  Hover or tap opens the exact count in a lazy popover (or bottom sheet on phones). */
export function ContextMeter({ botId, botName }: { botId: string; botName: string }) {
  const context = useBotStore(state => state.bots.find(candidate => candidate.id === botId)?.context)
  const view = contextMeterView(context)
  const [open, setOpen] = useState(false)
  const [used, setUsed] = useState(false)
  const pill = useRef<HTMLButtonElement>(null)
  const pinned = useRef(false)
  const down = useRef<TriggerState | null>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(
    () => () => {
      clearTimeout(openTimer.current)
      clearTimeout(closeTimer.current)
    },
    []
  )

  const clearTimers = () => {
    clearTimeout(openTimer.current)
    clearTimeout(closeTimer.current)
  }

  const handleOpenChange = (next: boolean) => {
    clearTimers()
    if (!next) pinned.current = false
    setOpen(next)
  }

  const onPillEnter = (event: PointerEvent<HTMLButtonElement>) => {
    void loadPopover()
    if (event.pointerType !== 'mouse') return
    clearTimeout(closeTimer.current)
    if (open) return
    openTimer.current = setTimeout(() => {
      setUsed(true)
      setOpen(true)
    }, 120)
  }

  const onPillLeave = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== 'mouse') return
    clearTimeout(openTimer.current)
    if (pinned.current) return
    closeTimer.current = setTimeout(() => setOpen(false), 150)
  }

  const onPopoverEnter = () => clearTimeout(closeTimer.current)

  const onPopoverLeave = () => {
    if (pinned.current) return
    closeTimer.current = setTimeout(() => setOpen(false), 150)
  }

  const onPointerDownCapture = () => {
    clearTimers()
    down.current = { open, pinned: pinned.current }
  }

  const onClick = () => {
    void loadPopover()
    clearTimers()
    const next = contextMeterOnClick({ open, pinned: pinned.current }, down.current)
    down.current = null
    if (next.open) setUsed(true)
    pinned.current = next.pinned
    setOpen(next.open)
  }

  return (
    <>
      <button
        ref={pill}
        type="button"
        onPointerEnter={onPillEnter}
        onPointerLeave={onPillLeave}
        onPointerDownCapture={onPointerDownCapture}
        onKeyDown={() => {
          down.current = null
        }}
        onFocus={() => void loadPopover()}
        onClick={onClick}
        aria-label={view.muted ? 'Context size: not reported yet' : `Context size: ${view.label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'inline-flex h-7 flex-none items-center gap-1.5 rounded-full bg-foreground/6 pr-2.5 pl-2 text-[13px]/[18px] font-medium tabular-nums outline-none transition-colors hover:bg-foreground/10 focus-visible:ring-3 focus-visible:ring-ring/50',
          view.muted ? 'text-muted-foreground' : 'text-foreground'
        )}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="size-4 shrink-0">
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" className="text-foreground/15" />
          {view.ratio !== null && view.ratio > 0 && (
            <circle
              cx="8"
              cy="8"
              r="6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={`${view.ratio * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
              transform="rotate(-90 8 8)"
              className="text-foreground"
            />
          )}
        </svg>
        <span>{view.label}</span>
      </button>
      {used && (
        <Suspense>
          <ContextPopover
            botName={botName}
            context={context}
            open={open}
            onOpenChange={handleOpenChange}
            anchor={pill}
            onHoverEnter={onPopoverEnter}
            onHoverLeave={onPopoverLeave}
          />
        </Suspense>
      )}
    </>
  )
}
