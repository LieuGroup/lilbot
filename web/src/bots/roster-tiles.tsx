import { cn } from 'cn'
import { EllipsisIcon } from 'lucide-react'

import { Button } from '@/ui/button'
import type { Bot } from '../../../shared/bot-schema'
import { rowState } from '../../../shared/client/bots/row-state'
import { AvatarMarks, botLabel } from './avatar-marks'
import { BotLink, menuOnContext } from './bot-link'
import { openBotMenu } from './bot-menu-target'
import type { DetailsTab } from './details-tabs'

/** The strip above the sections: the primary bot, then pinned bots in the order they were
 *  pinned. Tiles share the width equally, at most three to a line; a shorter last line keeps the
 *  same width, and the tiles in a line are as tall as the tallest. */
export function RosterTiles({ bots, openId, tab }: { bots: Bot[]; openId?: string; tab?: DetailsTab }) {
  const three = bots.length > 2
  return (
    <li>
      <ul aria-label="Pinned" className={cn('grid gap-1 pt-1 pb-2', three ? 'grid-cols-3' : 'grid-cols-2')}>
        {bots.map(bot => (
          <RosterTile key={bot.id} bot={bot} active={bot.id === openId} tab={tab} narrow={three} />
        ))}
      </ul>
    </li>
  )
}

/** A tile has no status line: its title gives the name and the row's one-line state. The name
 *  takes up to two lines. The "more" button appears at its top right on hover; it and a
 *  right-click open the bot menu. On a touch screen it always shows, with a 44pt tap area (#318). */
function RosterTile({ bot, active, tab, narrow }: { bot: Bot; active: boolean; tab?: DetailsTab; narrow: boolean }) {
  const label = botLabel(bot)
  return (
    <li className="group relative min-w-0" onContextMenu={menuOnContext(bot.id)}>
      <BotLink
        botId={bot.id}
        active={active}
        tab={tab}
        title={label}
        aria-label={label}
        className={cn(
          'flex h-full flex-col items-center gap-1.5 rounded-xl pt-2.5 pb-2 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
          narrow ? 'px-1' : 'px-1.5',
          active ? 'bg-foreground/6' : 'hover:bg-foreground/4'
        )}
      >
        <AvatarMarks bot={bot} size="tile" active={active} />
        <span className={cn('line-clamp-2 w-full text-center text-xs/[15px] text-foreground wrap-break-word', rowState(bot).unread ? 'font-semibold' : 'font-medium')}>
          {bot.name}
        </span>
      </BotLink>
      <Button
        variant="ghost"
        aria-label={`More for ${bot.name}`}
        aria-haspopup="menu"
        onClick={event => openBotMenu(bot.id, event.currentTarget)}
        className="absolute top-1 right-1 size-5 rounded-[6px] bg-card p-0 text-foreground opacity-0 ring-1 ring-hairline group-hover:opacity-100 group-has-focus-visible:opacity-100 after:absolute after:-inset-3 hover:bg-card dark:hover:bg-card pointer-coarse:opacity-100 [&_svg]:size-3.5"
      >
        <EllipsisIcon strokeWidth={1.75} />
      </Button>
    </li>
  )
}
