import { Link } from '@tanstack/react-router'
import { XIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { buttonVariants } from '@/ui/button'

/** The frame of a details panel beside a bot's chat: a title, a close link back to the chat, and
 *  a scrolling body. On a phone it fills the screen. */
export function Panel({ title, botId, children }: { title: string; botId: string; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-card">
      <header className="flex items-center justify-between gap-3 border-b px-4 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5">
        <h2 className="truncate text-[17px] font-semibold">{title}</h2>
        <Link to="/bots/$botId" params={{ botId }} aria-label="Close" className={buttonVariants({ variant: 'ghost', size: 'icon-lg', className: '-mr-2' })}>
          <XIcon className="size-5" />
        </Link>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-8 px-4 py-6">{children}</div>
      </div>
    </div>
  )
}
