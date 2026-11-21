/** Loaded only while a group runs (Paper "18 Bots working together" frame 6): the roster's "Working together" section and the
 *  rail's group slots. Both come from `bots.list` (each bot's running `groups`), so they go with the last group to disband. */
import { Link } from '@tanstack/react-router'
import { cn } from 'cn'
import type { ComponentProps } from 'react'
import { BotBadge } from '@/ui/bot-badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import type { Bot } from '../../../shared/bot-schema'
import { useBotStore } from '../bots/bot-store'
import { useOpenBotId } from '../bots/details-tabs'
import { RosterSection } from '../bots/roster-group'
import { StatusIcon } from '../bots/status-icon'
import { type RunningGroup, runningGroups } from './group-lines'
import { useOpenThreadId } from './open-thread'
import { plural } from './thread-lines'

const progress = (group: RunningGroup) => `Round ${group.round} · ${plural(group.bots.length, 'bot')}`

/** Opens the group in its leader's conversation column. */
function GroupLink({ group, className, ...rest }: { group: RunningGroup; className: string } & Omit<ComponentProps<'a'>, 'href'>) {
  const threadId = useOpenThreadId()
  const botId = useOpenBotId()
  const active = threadId === group.id && botId === group.bots[0].id
  return (
    <Link
      to="/bots/$botId"
      params={{ botId: group.bots[0].id }}
      search={{ thread: group.id }}
      aria-current={active ? 'page' : undefined}
      className={cn(className, 'outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50', active ? 'bg-foreground/6' : 'hover:bg-foreground/4')}
      {...rest}
    />
  )
}

/** The group's first four bots, 2 by 2, in a 36px tile. */
function GroupTile({ bots }: { bots: Bot[] }) {
  return (
    <span aria-hidden className="flex size-9 flex-none flex-wrap content-start gap-0.5 rounded-md bg-foreground/6 p-0.5">
      {bots.slice(0, 4).map(bot => (
        <BotBadge key={bot.id} name={bot.name} avatar={bot.prefs.avatar} size={15} />
      ))}
    </span>
  )
}

/** At the very top of the roster: one row per running group, the tile, its purpose and "Round N · N bots". */
export function WorkingTogether() {
  const groups = runningGroups(useBotStore(state => state.bots))
  if (groups.length === 0) return null
  return (
    <RosterSection name="Working together">
      {groups.map(group => (
        <li key={group.id}>
          <GroupLink group={group} className="flex h-13 items-center gap-2.5 rounded-lg px-2">
            <GroupTile bots={group.bots} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm/5 font-medium">{group.purpose}</span>
              <span className="flex min-w-0 items-center gap-[5px] text-[13px]/[18px] text-muted-foreground">
                <StatusIcon tone="working" />
                <span className="truncate">{progress(group)}</span>
              </span>
            </span>
          </GroupLink>
        </li>
      ))}
    </RosterSection>
  )
}

/** In the collapsed rail, above the bots: one slot per running group with the same tile, then a short line. */
export function RailGroups() {
  const groups = runningGroups(useBotStore(state => state.bots))
  if (groups.length === 0) return null
  return (
    <>
      {groups.map(group => (
        <li key={group.id}>
          <Tooltip>
            <TooltipTrigger render={<GroupLink group={group} aria-label={`Group · ${group.purpose}`} className="flex size-12 items-center justify-center rounded-xl" />}>
              <GroupTile bots={group.bots} />
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={6}>
              <span className="text-[13px]/[18px] font-medium">{group.purpose}</span>
              <span className="text-xs text-background/70">{progress(group)}</span>
            </TooltipContent>
          </Tooltip>
        </li>
      ))}
      <li aria-hidden="true" className="h-px w-7 flex-none bg-hairline" />
    </>
  )
}
