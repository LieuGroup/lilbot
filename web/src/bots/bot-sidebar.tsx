import { lazy, Suspense } from 'react'

import { Notice } from '@/ui/notice'
import { WorkNavRow } from '../work/work-nav-row'
import { loadBotMenu } from './bot-menu-target'
import { useBotStore } from './bot-store'
import { useDetailsTab, useOpenBotId } from './details-tabs'
import { RosterFooter } from './roster-footer'
import { RosterCollapsedGroup, RosterSection } from './roster-group'
import { rosterGroups, searchBots } from './roster-groups'
import { RosterHeader } from './roster-header'
import { RosterOverlays } from './roster-overlays'
import { RosterRow } from './roster-row'
import { RosterTiles } from './roster-tiles'
import { loadRail, setQuery, useRailShown, useRosterView } from './roster-view'

const RosterRail = lazy(() => loadRail().then(module => ({ default: module.RosterRail })))
// Loaded only once a bot is in a running group.
const WorkingTogether = lazy(() => import('../threads/working-together').then(module => ({ default: module.WorkingTogether })))

/** The roster: the running groups ("Working together"), the primary and pinned bots as tiles (alone, the primary is an ordinary row), then
 *  the user's sections, then the collapsed "Unassigned" and "Hidden" groups. With no sections yet,
 *  the other bots are listed plainly. On a wide screen it can collapse to the rail. */
export function BotSidebar() {
  const rail = useRailShown()
  if (rail)
    return (
      <Suspense fallback={<div className="h-full w-16 bg-background" />}>
        <RosterRail />
      </Suspense>
    )
  return <OpenRoster />
}

function OpenRoster() {
  const { bots, sections, loaded, connected, error, deploymentNotice } = useBotStore()
  const query = useRosterView(state => state.query)
  const openId = useOpenBotId()
  const tab = useDetailsTab()
  const groups = rosterGroups(bots, sections)
  const row = (bot: (typeof bots)[number]) => <RosterRow key={bot.id} bot={bot} active={bot.id === openId} tab={tab} />
  const holdsOpen = (list: typeof bots) => list.some(bot => bot.id === openId)
  const sectioned = groups.sections.length > 0

  return (
    <nav aria-label="Bots" className="flex h-full w-full flex-col bg-background md:w-[272px]" onPointerEnter={() => void loadBotMenu()}>
      <RosterHeader query={query} onQuery={setQuery} />
      <div className="flex-1 overflow-y-auto px-2 pt-1 pb-2">
        {!loaded && <p className="px-2 py-3 text-[13px] text-muted-foreground">{error || (connected ? 'Loading bots...' : 'Connecting...')}</p>}
        {query !== null ? (
          <ul className="flex flex-col gap-0.5">
            {searchBots(bots, query).map(row)}
            {loaded && query.trim() && searchBots(bots, query).length === 0 && <li className="px-2 py-3 text-[13px] text-muted-foreground">No bot matches.</li>}
          </ul>
        ) : (
          <ul className="flex flex-col gap-0.5">
            <WorkNavRow />
            {bots.some(bot => bot.groups?.length) && (
              <Suspense>
                <WorkingTogether />
              </Suspense>
            )}
            {groups.tiled ? <RosterTiles bots={groups.top} openId={openId} tab={tab} /> : groups.top.map(row)}
            {groups.sections.map(group => (
              <RosterSection key={group.section.id} name={group.section.name}>
                {group.bots.map(row)}
              </RosterSection>
            ))}
            {sectioned
              ? groups.unassigned.length > 0 && (
                  <RosterCollapsedGroup id="unassigned" name="Unassigned" count={groups.unassigned.length} holdsActive={holdsOpen(groups.unassigned)}>
                    {groups.unassigned.map(row)}
                  </RosterCollapsedGroup>
                )
              : groups.unassigned.map(row)}
            {groups.hidden.length > 0 && (
              <RosterCollapsedGroup id="hidden" name="Hidden" count={groups.hidden.length} holdsActive={holdsOpen(groups.hidden)} tight={sectioned && groups.unassigned.length > 0}>
                {groups.hidden.map(row)}
              </RosterCollapsedGroup>
            )}
          </ul>
        )}
      </div>
      {deploymentNotice && (
        <div className="px-2 pb-2">
          <Notice tone="error">{deploymentNotice}</Notice>
        </div>
      )}
      <RosterFooter connected={connected} />
      <RosterOverlays />
    </nav>
  )
}
