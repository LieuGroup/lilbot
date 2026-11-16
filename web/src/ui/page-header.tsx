import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

/** Top bar of a page. The back arrow only shows on phones, where the bot list is its own screen. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="flex items-center gap-3 border-b border-border bg-surface px-4 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5">
      <Link to="/" aria-label="Back to bots" className="-ml-1 flex size-9 flex-none items-center justify-center rounded-lg text-xl md:hidden">
        ‹
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[17px] font-semibold">{title}</h1>
        {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
      </div>
      <div className="flex flex-none items-center gap-2">{actions}</div>
    </header>
  )
}
