import { cn } from 'cn'
import { EllipsisIcon } from 'lucide-react'

import { Button } from '@/ui/button'
import type { Bot } from '../../../shared/bot-schema'
import { AvatarMarks, botLabel } from './avatar-marks'
import { BotLink, menuOnContext } from './bot-link'
import { openBotMenu } from './bot-menu-target'
import type { DetailsTab } from './details-tabs'
import { rowState } from './row-state'

/** The strip above the sections: the primary bot, then pinned bots in the order they were
 *  pinned. Three 82px tiles fit across; more wrap onto another line. */
export function RosterTiles({ bots, openId, tab }: { bots: Bot[]; openId?: string; tab?: DetailsTab }) {
  if (bots.length === 0) return null
  return (
    <li>
      <ul aria-label="Pinned" className="flex flex-wrap gap-1 pt-1 pb-2">
        {bots.map(bot => (
          <RosterTile key={bot.id} bot={bot} active={bot.id === openId} tab={tab} />
        ))}
      </ul>
    </li>
  )
}

/** A tile has no status line: its title gives the name and the row's one-line state. The "more"
 *  button appears at its top right on hover; it and a right-click open the bot menu. */
function RosterTile({ bot, active, tab }: { bot: Bot; active: boolean; tab?: DetailsTab }) {
  const label = botLabel(bot)
  return (
    <li className="group relative" onContextMenu={menuOnContext(bot.id)}>
      <BotLink
        botId={bot.id}
        active={active}
        tab={tab}
        title={label}
        aria-label={label}
        className={cn(
          'flex w-[82px] flex-col items-center gap-1.5 rounded-xl px-1 pt-2.5 pb-2 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
          active ? 'bg-foreground/6' : 'hover:bg-foreground/4'
        )}
      >
        <AvatarMarks bot={bot} size="tile" />
        <span className={cn('max-w-full truncate text-xs/4 text-foreground', rowState(bot).unread ? 'font-semibold' : 'font-medium')}>{bot.name}</span>
      </BotLink>
      <Button
        variant="ghost"
        aria-label={`More for ${bot.name}`}
        aria-haspopup="menu"
        onClick={event => openBotMenu(bot.id, event.currentTarget)}
        className="absolute top-1 right-1 size-5 rounded-[6px] bg-card p-0 text-foreground opacity-0 ring-1 ring-hairline group-hover:opacity-100 group-has-focus-visible:opacity-100 hover:bg-card dark:hover:bg-card [&_svg]:size-3.5"
      >
        <EllipsisIcon strokeWidth={1.75} />
      </Button>
    </li>
  )
}
