import { Link } from '@tanstack/react-router'
import { cn } from 'cn'
import { EllipsisIcon, StarIcon } from 'lucide-react'

import { BotBadge } from '@/ui/bot-badge'
import { Button } from '@/ui/button'
import type { Bot } from '../../../shared/bot-schema'
import { openBotMenu, pointAnchor } from './bot-menu-target'
import type { DetailsTab } from './details-tabs'
import { rowState } from './row-state'
import { StatusIcon } from './status-icon'

/** One bot in the roster: avatar, name, one line of live state or preview, and a 16px trailing
 *  slot for the unread dot (the "more" button takes its place on hover). The "more" button and
 *  a right-click open the bot menu. Opening another bot keeps the details tab that is open. */
export function RosterRow({ bot, active, tab }: { bot: Bot; active: boolean; tab?: DetailsTab }) {
  const state = rowState(bot)
  const quiet = state.tone === 'idle' && !state.unread && !bot.isPrimary
  const lineColor = state.tone === 'failed' ? 'text-destructive' : state.unread || state.tone === 'waiting' ? 'text-foreground' : 'text-muted-foreground'
  const row = cn(
    'flex h-13 items-center gap-2.5 rounded-lg px-2 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
    active ? 'bg-card shadow-xs shadow-foreground/4 ring-1 ring-hairline' : 'hover:bg-foreground/4'
  )
  const content = (
    <>
      <BotBadge name={bot.name} avatar={bot.prefs.avatar} size={36} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-[5px]">
          <span className={cn('truncate text-sm/5', state.unread ? 'font-semibold' : 'font-medium', quiet ? 'text-foreground/80' : 'text-foreground')}>{bot.name}</span>
          {bot.isPrimary && <StarIcon role="img" aria-label="Primary bot" strokeWidth={0} className="size-[11px] flex-none fill-foreground/40" />}
        </span>
        <span className={cn('flex min-w-0 items-center gap-[5px] text-[13px]/[18px]', lineColor)}>
          {state.tone !== 'idle' && <StatusIcon tone={state.tone} />}
          <span className="truncate">{state.text}</span>
        </span>
      </span>
      <span className="flex w-4 flex-none justify-center">
        {state.unread && (
          <span className="size-2 rounded-full bg-primary transition-opacity group-hover:opacity-0 group-has-focus-visible:opacity-0">
            <span className="sr-only">Unread</span>
          </span>
        )}
      </span>
    </>
  )

  return (
    <li
      className="group relative"
      onContextMenu={event => {
        event.preventDefault()
        openBotMenu(bot.id, pointAnchor(event.clientX, event.clientY))
      }}
    >
      {tab ? (
        <Link to="/bots/$botId/$tab" params={{ botId: bot.id, tab }} aria-current={active ? 'page' : undefined} className={row}>
          {content}
        </Link>
      ) : (
        <Link to="/bots/$botId" params={{ botId: bot.id }} aria-current={active ? 'page' : undefined} className={row}>
          {content}
        </Link>
      )}
      <Button
        variant="ghost"
        aria-label={`More for ${bot.name}`}
        aria-haspopup="menu"
        onClick={event => openBotMenu(bot.id, event.currentTarget)}
        className="absolute top-1/2 right-2 size-4 -translate-y-1/2 rounded-sm p-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-has-focus-visible:opacity-100 hover:bg-transparent hover:text-foreground"
      >
        <EllipsisIcon strokeWidth={1.75} />
      </Button>
    </li>
  )
}
