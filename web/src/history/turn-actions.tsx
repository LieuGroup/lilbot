import { ChartNoAxesColumnIcon, CheckIcon, CopyIcon } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'

import { iconButton } from '@/ui/icon-button'
import type { TurnUsage } from '../../../shared/chat-schema'

const loadPanel = () => import('./turn-usage-panel')
const TurnUsagePanel = lazy(loadPanel)

/** Small action marks under a finished assistant reply: copy the text, or open the turn's token and cache counts (Paper artboard 21, frame 1). */
export function TurnActions({ text, usage }: { text: string; usage?: TurnUsage }) {
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const [used, setUsed] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const closedAt = useRef(0)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(copyTimer.current), [])

  const copy = () => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true)
        clearTimeout(copyTimer.current)
        copyTimer.current = setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }

  const handleOpenChange = (next: boolean) => {
    if (!next && open) closedAt.current = Date.now()
    setOpen(next)
  }

  const toggle = () => {
    void loadPanel()
    if (!open && Date.now() - closedAt.current < 250) return
    setUsed(true)
    setOpen(current => !current)
  }

  return (
    <div className="-ml-1.5 flex items-center gap-1">
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy reply'}
        title={copied ? 'Copied' : 'Copy reply'}
        className={iconButton({ className: 'rounded-lg' })}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
      <button
        ref={trigger}
        type="button"
        onPointerEnter={() => void loadPanel()}
        onFocus={() => void loadPanel()}
        onClick={toggle}
        aria-label="Turn numbers"
        title="Turn numbers"
        aria-haspopup="dialog"
        aria-expanded={open}
        className={iconButton({ on: open, className: 'rounded-lg' })}
      >
        <ChartNoAxesColumnIcon />
      </button>
      {used && (
        <Suspense>
          <TurnUsagePanel usage={usage} open={open} onOpenChange={handleOpenChange} anchor={trigger} />
        </Suspense>
      )}
    </div>
  )
}
