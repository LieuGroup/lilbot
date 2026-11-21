import { Link } from '@tanstack/react-router'
import { cn } from 'cn'
import { PanelLeftIcon, PlusIcon, SearchIcon, SlidersHorizontalIcon } from 'lucide-react'
import { Fragment, lazy, Suspense } from 'react'

import { iconButton } from '@/ui/icon-button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/tooltip'
import type { Bot } from '../../../shared/bot-schema'
import { loadSettings, openSettings } from '../settings/settings-store'
import { AvatarMarks, botLabel } from './avatar-marks'
import { BotLink, menuOnContext } from './bot-link'
import { loadBotMenu } from './bot-menu-target'
import { useBotStore } from './bot-store'
import { type DetailsTab, useDetailsTab, useOpenBotId } from './details-tabs'
import { railGroups, rosterGroups } from './roster-groups'
import { RosterOverlays } from './roster-overlays'
import { setCollapsed, useRosterView } from './roster-view'
import { rowState } from './row-state'

const RailGroups = lazy(() => import('../threads/working-together').then(module => ({ default: module.RailGroups })))

/** The collapsed roster, 64px: the app icon, a slot per running group, avatars in the open roster's order with a short line
 *  between groups, then open, search, new bot, settings and the user. Loaded only when used. */
export function RosterRail() {
  const { bots, sections, connected } = useBotStore()
  const open = useRosterView(state => state.open)
  const openId = useOpenBotId()
  const tab = useDetailsTab()
  const groups = railGroups(rosterGroups(bots, sections), (group, list) => open[group] || list.some(bot => bot.id === openId))

  return (
    <nav aria-label="Bots" className="flex h-full w-16 flex-col items-center bg-background" onPointerEnter={() => void loadBotMenu()}>
      <div className="flex h-[52px] flex-none items-center">
        <img src="/favicon-32.png" srcSet="/favicon-32.png 1x, /icon-192.png 2x" alt="LilBot" className="size-[22px] rounded-[6px]" />
      </div>
      <TooltipProvider delay={300}>
        <ul className="flex w-full flex-1 flex-col items-center gap-1 overflow-y-auto pt-1 pb-2">
          {bots.some(bot => bot.groups?.length) && (
            <Suspense>
              <RailGroups />
            </Suspense>
          )}
          {groups.map((list, index) => (
            <Fragment key={list[0].id}>
              {index > 0 && <li aria-hidden="true" className="h-px w-7 flex-none bg-hairline" />}
              {list.map(bot => (
                <RailSlot key={bot.id} bot={bot} active={bot.id === openId} tab={tab} />
              ))}
            </Fragment>
          ))}
        </ul>
      </TooltipProvider>
      <div className="flex flex-none flex-col items-center gap-1.5 pt-2 pb-[max(12px,env(safe-area-inset-bottom))]">
        <button type="button" className={iconButton()} aria-label="Open roster" title="Open roster" onClick={() => setCollapsed(false)}>
          <PanelLeftIcon />
        </button>
        <button type="button" className={iconButton()} aria-label="Search bots" title="Search bots" onClick={() => setCollapsed(false, '')}>
          <SearchIcon />
        </button>
        <Link to="/bots/new" className={iconButton()} aria-label="New bot" title="New bot">
          <PlusIcon />
        </Link>
        <button type="button" className={iconButton()} aria-label="Settings" title="Settings" onPointerEnter={() => void loadSettings()} onClick={() => openSettings()}>
          <SlidersHorizontalIcon />
        </button>
        {connected ? (
          <span title="Oscar" className="mt-1 flex size-6 items-center justify-center rounded-full bg-foreground/8 text-[11px]/[14px] font-semibold">
            O
          </span>
        ) : (
          <span role="status" title="Offline · reconnecting" className="mt-1 flex size-6 items-center justify-center">
            <span className="size-2 animate-pulse rounded-full bg-destructive" />
            <span className="sr-only">Offline, reconnecting</span>
          </span>
        )}
      </div>
      <RosterOverlays />
    </nav>
  )
}

/** One avatar in a 48px slot. Pointing at it shows the name and the row's one-line state;
 *  right-click opens the bot menu. */
function RailSlot({ bot, active, tab }: { bot: Bot; active: boolean; tab?: DetailsTab }) {
  return (
    <li onContextMenu={menuOnContext(bot.id)}>
      <Tooltip>
        <TooltipTrigger
          render={
            <BotLink
              botId={bot.id}
              active={active}
              tab={tab}
              aria-label={botLabel(bot)}
              className={cn(
                'flex size-12 items-center justify-center rounded-xl outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
                active ? 'bg-foreground/6' : 'hover:bg-foreground/4'
              )}
            />
          }
        >
          <AvatarMarks bot={bot} size="rail" />
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={6}>
          <span className="text-[13px]/[18px] font-medium">{bot.name}</span>
          <span className="text-xs text-background/70">{rowState(bot).text}</span>
        </TooltipContent>
      </Tooltip>
    </li>
  )
}
