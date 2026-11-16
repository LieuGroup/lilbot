import { Link } from '@tanstack/react-router'
import { ChevronLeftIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { iconButton } from '@/ui/icon-button'

/** One 52px line at the top of a page: title, a muted subtitle beside it, actions on the right.
 *  The back arrow only shows on phones, where the bot list is its own screen. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex h-[calc(52px+env(safe-area-inset-top))] flex-none items-center gap-2 pt-[env(safe-area-inset-top)] pr-3 pl-3 md:pl-6">
      <Link to="/bots" aria-label="Back to bots" className={iconButton({ className: 'md:hidden' })}>
        <ChevronLeftIcon />
      </Link>
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <h1 className="flex-none truncate text-sm/5 font-semibold tracking-[-0.01em] max-md:flex-1">{title}</h1>
        {subtitle && <p className="truncate text-[13px]/[18px] text-muted-foreground max-md:hidden">{subtitle}</p>}
      </div>
      <div className="flex flex-none items-center gap-0.5">{actions}</div>
    </header>
  )
}
