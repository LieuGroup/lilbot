import { Link } from '@tanstack/react-router'
import { PlusIcon, StarIcon } from 'lucide-react'

import { BotBadge } from '@/ui/bot-badge'
import { buttonVariants } from '@/ui/button'
import { useBotStore } from './bot-store'
import { rosterBots } from './primary-bot'

export function BotSidebar() {
  const { bots, loaded, connected, error } = useBotStore()

  return (
    <nav aria-label="Bots" className="flex h-full flex-col bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <div className="flex items-center gap-2">
          <span title={connected ? 'Connected' : 'Disconnected'} className={`size-2.5 rounded-full ${connected ? 'bg-success' : 'bg-destructive'}`} />
          <span className="text-lg font-semibold">LilBot</span>
        </div>
        <Link to="/bots/new" className={buttonVariants({ variant: 'outline' })}>
          <PlusIcon />
          New bot
        </Link>
      </div>

      <ul className="flex-1 overflow-y-auto p-2">
        {!loaded && <li className="px-2 py-3 text-sm text-muted-foreground">{error || (connected ? 'Loading bots...' : 'Connecting...')}</li>}
        {rosterBots(bots).map(bot => (
          <li key={bot.id} className={bot.isPrimary ? 'mb-2 border-b pb-2' : undefined}>
            <Link
              to="/bots/$botId"
              params={{ botId: bot.id }}
              className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-muted"
              activeProps={{ className: 'bg-muted' }}
              activeOptions={{ exact: false }}
            >
              <BotBadge name={bot.name} avatar={bot.prefs.avatar} />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-medium">{bot.name}</span>
                  {bot.isPrimary && (
                    <span className="flex flex-none items-center gap-1 text-xs text-muted-foreground">
                      <StarIcon aria-hidden="true" className="size-3 fill-current" />
                      Primary
                    </span>
                  )}
                </span>
                <span className="block truncate text-sm text-muted-foreground">{bot.function || 'No function set'}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
