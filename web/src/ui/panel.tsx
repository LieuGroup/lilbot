import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

/** The frame of a details panel beside a bot's chat: a title, a close link back to the chat, and
 *  a scrolling body. On a phone it fills the screen. */
export function Panel({ title, botId, children }: { title: string; botId: string; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5">
        <h2 className="truncate text-[17px] font-semibold">{title}</h2>
        <Link to="/bots/$botId" params={{ botId }} className="rounded-xl border border-border px-3 py-1.5 text-sm font-medium">
          Close
        </Link>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-8 px-4 py-6">{children}</div>
      </div>
    </div>
  )
}
