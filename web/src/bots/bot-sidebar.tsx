import { Link } from '@tanstack/react-router'

import { BotBadge } from '../ui/controls'
import { useBotStore } from './bot-store'

export function BotSidebar() {
  const { bots, loaded, connected, error } = useBotStore()

  return (
    <nav aria-label="Bots" className="flex h-full flex-col bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <div className="flex items-center gap-2">
          <span title={connected ? 'Connected' : 'Disconnected'} className={`size-2.5 rounded-full ${connected ? 'bg-ok' : 'bg-danger'}`} />
          <span className="text-lg font-semibold">LeBot</span>
        </div>
        <Link to="/bots/new" className="rounded-xl border border-border px-3 py-1.5 text-sm font-medium">
          New bot
        </Link>
      </div>

      <ul className="flex-1 overflow-y-auto p-2">
        {!loaded && <li className="px-2 py-3 text-sm text-muted">{error || (connected ? 'Loading bots...' : 'Connecting...')}</li>}
        {bots.map(bot => (
          <li key={bot.id}>
            <Link
              to="/bots/$botId"
              params={{ botId: bot.id }}
              className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-bg"
              activeProps={{ className: 'bg-bg' }}
              activeOptions={{ exact: false }}
            >
              <BotBadge name={bot.name} avatar={bot.prefs.avatar} />
              <span className="min-w-0">
                <span className="block truncate font-medium">{bot.name}</span>
                <span className="block truncate text-sm text-muted">{bot.function || 'No function set'}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
