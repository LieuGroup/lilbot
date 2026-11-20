import { Link, Navigate, useParams } from '@tanstack/react-router'
import { XIcon } from 'lucide-react'
import { type ComponentType, type LazyExoticComponent, lazy, Suspense } from 'react'

import { BotBadge } from '@/ui/bot-badge'
import { iconButton } from '@/ui/icon-button'
import { useBotStore } from './bot-store'
import { DETAILS_TABS, type DetailsTab, isDetailsTab, rememberDetailsOpen } from './details-tabs'

type TabContent = LazyExoticComponent<ComponentType<{ botId: string }>>

// Each tab's content loads on first use, so the chat's first load stays small.
const tabContent: Record<DetailsTab, TabContent> = {
  activity: lazy(() => import('../activity/activity-tab').then(module => ({ default: module.ActivityTab }))),
  library: lazy(() => import('../library/library-tab').then(module => ({ default: module.LibraryTab }))),
  memory: lazy(() => import('../memory/memory-panel').then(module => ({ default: module.MemoryPanel }))),
  setup: lazy(() => import('./bot-setup-panel').then(module => ({ default: module.BotSetupPanel })))
}

/** The details panel beside the chat: the bot's avatar and name, then pill tabs. Each tab is its
 *  own route, so a link or a reload opens the same tab. On a phone it covers the chat. */
export function BotDetailsPanel() {
  const { botId, tab } = useParams({ from: '/bots/$botId/$tab' })
  const bot = useBotStore(state => state.bots.find(candidate => candidate.id === botId))
  if (!isDetailsTab(tab)) return <Navigate to="/bots/$botId" params={{ botId }} replace />
  const Content = tabContent[tab]

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <Link
        to="/bots/$botId"
        params={{ botId }}
        search
        onClick={() => rememberDetailsOpen(false)}
        aria-label="Back to the chat"
        className={iconButton({ className: 'absolute top-[calc(12px+env(safe-area-inset-top))] left-3 md:hidden' })}
      >
        <XIcon />
      </Link>
      <div className="flex flex-none flex-col items-center gap-3 px-5 pt-[calc(36px+env(safe-area-inset-top))] pb-[18px]">
        {bot && <BotBadge name={bot.name} avatar={bot.prefs.avatar} size={64} />}
        <h2 className="max-w-full truncate text-base/[22px] font-semibold tracking-[-0.01em]">{bot?.name ?? botId}</h2>
      </div>
      <nav aria-label="Details" className="flex flex-none justify-center gap-0.5 px-4 pb-4">
        {DETAILS_TABS.map(item => (
          <Link
            key={item.id}
            to="/bots/$botId/$tab"
            params={{ botId, tab: item.id }}
            search
            className="rounded-full px-2.5 py-1 text-[13px]/[18px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            activeProps={{ className: 'bg-foreground/6 font-medium text-foreground', 'aria-current': 'page' }}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Suspense fallback={<p className="px-5 py-2 text-[13px] text-muted-foreground">Loading...</p>}>
          <Content key={botId} botId={botId} />
        </Suspense>
      </div>
    </div>
  )
}
