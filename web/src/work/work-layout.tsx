/** Top bar and shell for the Work board: Today, All work, Goals, Checks (Paper artboard 20, frame 1). */
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { ChevronLeftIcon } from 'lucide-react'
import { Suspense } from 'react'
import { iconButton } from '@/ui/icon-button'

const TABS = [
  { to: '/work' as const, label: 'Today', exact: true },
  { to: '/work/all' as const, label: 'All work', exact: false },
  { to: '/work/goals' as const, label: 'Goals', exact: false },
  { to: '/work/checks' as const, label: 'Checks', exact: false }
]

/** Board layout: shows the Work tab header on board tabs; item and goal detail pages draw their own 52px header. */
export default function WorkLayout() {
  const pathname = useRouterState({ select: state => state.location.pathname })
  const isDetail = pathname.startsWith('/work/items/') || pathname.startsWith('/work/goals/')
  if (isDetail) {
    return (
      <div className="flex h-full min-w-0 flex-col bg-card">
        <Suspense fallback={<p className="px-6 py-5 text-[13px] text-muted-foreground">Loading...</p>}>
          <Outlet />
        </Suspense>
      </div>
    )
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-card">
      <header className="flex h-[calc(52px+env(safe-area-inset-top))] flex-none items-center gap-3 border-b border-hairline px-3 pt-[env(safe-area-inset-top)] md:gap-4 md:px-5">
        <Link to="/bots" aria-label="Back to bots" className={iconButton({ className: 'md:hidden' })}>
          <ChevronLeftIcon />
        </Link>
        <h1 className="flex-none text-sm/5 font-semibold tracking-[-0.01em]">Work</h1>
        <nav aria-label="Work sections" className="flex items-center gap-0.5 overflow-x-auto">
          {TABS.map(tab => {
            const active = tab.exact ? pathname === tab.to : pathname === tab.to || pathname.startsWith(`${tab.to}/`)
            return (
              <Link
                key={tab.to}
                to={tab.to}
                aria-current={active ? 'page' : undefined}
                className={`rounded-full px-2.5 py-1 text-[13px]/[18px] whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 ${
                  active ? 'bg-foreground/6 font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Suspense fallback={<p className="px-6 py-5 text-[13px] text-muted-foreground">Loading...</p>}>
          <Outlet />
        </Suspense>
      </div>
    </div>
  )
}
