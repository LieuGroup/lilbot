import { cn } from 'cn'
import { LoaderCircleIcon, StarIcon } from 'lucide-react'

import { BotBadge } from '@/ui/bot-badge'
import type { Bot } from '../../../shared/bot-schema'
import { rowState } from '../../../shared/client/bots/row-state'

const sizes = {
  tile: { avatar: 52, dot: 'top-0 right-0.5 size-3', badge: '-right-[3px] -bottom-[3px] size-[18px]', icon: 'size-3' },
  rail: { avatar: 36, dot: '-top-0.5 -right-0.5 size-2.5', badge: '-right-1 -bottom-1 size-[15px]', icon: 'size-2.5' }
}

/** A bot's avatar with its signals, for tiles and the rail: the blue unread dot at the top right;
 *  at the bottom right a blue spinner while it works, otherwise the primary bot's star. On an open
 *  tile the badge sits on the muted tint. */
export function AvatarMarks({ bot, size, active = false }: { bot: Bot; size: keyof typeof sizes; active?: boolean }) {
  const { tone, unread } = rowState(bot)
  const at = sizes[size]
  const badge = tone === 'working' ? 'working' : bot.isPrimary ? 'primary' : null
  return (
    <span className="relative flex-none">
      <BotBadge name={bot.name} avatar={bot.prefs.avatar} size={at.avatar} />
      {unread && <span className={cn('absolute rounded-full bg-primary ring-2 ring-background', at.dot)} />}
      {badge && (
        <span className={cn('absolute flex items-center justify-center rounded-full', active ? 'bg-muted' : 'bg-background', at.badge)}>
          {badge === 'working' ? (
            <LoaderCircleIcon aria-hidden="true" strokeWidth={3} className={cn('animate-spin text-primary', at.icon)} />
          ) : (
            <StarIcon aria-hidden="true" strokeWidth={0} className={cn('fill-foreground', at.icon)} />
          )}
        </span>
      )}
    </span>
  )
}

/** What a tile or rail avatar says when pointed at: the name and the row's one-line state. */
export function botLabel(bot: Bot): string {
  const state = rowState(bot)
  return [bot.name, bot.isPrimary && 'Primary bot', state.text, state.unread && 'Unread'].filter(Boolean).join(' · ')
}
