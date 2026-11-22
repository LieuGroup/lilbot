import { ChartNoAxesColumnIcon, CheckIcon, CopyIcon } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'

import { iconButton } from '@/ui/icon-button'
import type { TurnUsage } from '../../../shared/chat-schema'
import { toggleOnClick } from './usage-trigger'

const loadPanel = () => import('./turn-usage-panel')
const TurnUsagePanel = lazy(loadPanel)

/** Small action marks under a finished assistant reply: copy the text, or open the turn's token and cache counts (Paper artboard 21, frame 1). */
export function TurnActions({ text, usage, showUsage = true }: { text: string; usage?: TurnUsage; showUsage?: boolean }) {
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const [used, setUsed] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const down = useRef<{ open: boolean } | null>(null)
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

  const toggle = () => {
    void loadPanel()
    const next = toggleOnClick(open, down.current)
    down.current = null
    if (next) setUsed(true)
    setOpen(next)
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
      {showUsage && (
        <>
          <button
            ref={trigger}
            type="button"
            onPointerEnter={() => void loadPanel()}
            onPointerDownCapture={() => {
              down.current = { open }
            }}
            onKeyDown={() => {
              down.current = null
            }}
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
              <TurnUsagePanel usage={usage} open={open} onOpenChange={setOpen} anchor={trigger} />
            </Suspense>
          )}
        </>
      )}
    </div>
  )
}
