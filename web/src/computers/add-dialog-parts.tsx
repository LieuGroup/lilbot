import { CheckIcon, ClockIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/ui/button'
import { DialogDescription, DialogTitle } from '@/ui/dialog'

export const TEXT_BUTTON = 'h-8 rounded-lg px-3 text-[13px]/[18px] font-medium'

export function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <DialogTitle className="text-base/[22px] font-semibold tracking-[-0.01em]">{title}</DialogTitle>
      {children && <DialogDescription className="text-[13px]/5 text-muted-foreground">{children}</DialogDescription>}
    </div>
  )
}

/** The bottom row: a quiet line or link on the left, the buttons on the right. */
export function Footer({ left, children }: { left?: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-auto flex items-center justify-between gap-3 pt-1">
      <div className="min-w-0 text-xs text-muted-foreground">{left}</div>
      <div className="flex flex-none gap-1.5">{children}</div>
    </div>
  )
}

export function QuietLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded-sm text-xs font-medium outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
      {children}
    </button>
  )
}

export function CancelButton({ onClick, label = 'Cancel' }: { onClick: () => void; label?: string }) {
  return (
    <Button variant="ghost" className={TEXT_BUTTON} onClick={onClick}>
      {label}
    </Button>
  )
}

export function Badge({ tone }: { tone: 'success' | 'quiet' }) {
  const Icon = tone === 'success' ? CheckIcon : ClockIcon
  return (
    <div className={`flex size-10 flex-none items-center justify-center rounded-full ${tone === 'success' ? 'bg-success/12 text-success' : 'bg-foreground/6'}`}>
      <Icon className="size-5 stroke-[1.75]" />
    </div>
  )
}
