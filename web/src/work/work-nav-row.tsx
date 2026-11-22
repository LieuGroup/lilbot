/** "Work" entry at the top of the bot list (Paper artboard 20, frame 1). */
import { Link, useRouterState } from '@tanstack/react-router'
import { cn } from 'cn'
import { useNeedsYouCount } from './work-badge-store'

/** Board icon matching Paper artboard 20 (16px, stroke 1.75). */
export function WorkIcon({ className = 'size-4 flex-none' }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <rect x="4" y="4.5" width="16" height="15" rx="3" stroke="currentColor" strokeWidth="1.75" />
      <path d="M8 9.5h8M8 13.5h5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

export function useAtWork() {
  return useRouterState({ select: state => state.location.pathname === '/work' || state.location.pathname.startsWith('/work/') })
}

export function WorkNavRow() {
  const active = useAtWork()
  const count = useNeedsYouCount()
  return (
    <li className="pb-1">
      <Link
        to="/work"
        className={cn(
          'flex h-10 items-center gap-2.5 rounded-[10px] px-2 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
          active ? 'bg-card shadow-xs shadow-foreground/4 ring-1 ring-hairline' : 'hover:bg-foreground/4'
        )}
      >
        <WorkIcon className="size-4 flex-none text-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm/5 font-medium text-foreground">Work</span>
        {count > 0 && (
          <span className="rounded-full bg-primary px-[7px] py-px text-xs/4 font-semibold text-primary-foreground">
            {count}
            <span className="sr-only"> waiting for you</span>
          </span>
        )}
      </Link>
    </li>
  )
}
