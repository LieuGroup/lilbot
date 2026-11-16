import { Link } from '@tanstack/react-router'
import { ChevronLeftIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { buttonVariants } from '@/ui/button'

/** Top bar of a page. The back arrow only shows on phones, where the bot list is its own screen. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex items-center gap-2 border-b bg-card px-4 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5">
      <Link to="/bots" aria-label="Back to bots" className={buttonVariants({ variant: 'ghost', size: 'icon-lg', className: '-ml-2 md:hidden' })}>
        <ChevronLeftIcon className="size-5" />
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[17px] font-semibold">{title}</h1>
        {subtitle && <p className="truncate text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex flex-none items-center gap-1.5">{actions}</div>
    </header>
  )
}
