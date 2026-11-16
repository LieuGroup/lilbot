import { useState } from 'react'

import { useBotStore } from './bot-store'
import { useDetailsTab, useOpenBotId } from './details-tabs'
import { RosterFooter } from './roster-footer'
import { RosterCollapsedGroup, RosterSection } from './roster-group'
import { rosterGroups, searchBots } from './roster-groups'
import { RosterHeader } from './roster-header'
import { RosterRow } from './roster-row'

/** The roster: primary bot first, then the user's sections, then the collapsed "Unassigned" and
 *  "Hidden" groups. With no sections yet, every bot is listed plainly. */
export function BotSidebar() {
  const { bots, sections, loaded, connected, error } = useBotStore()
  const [query, setQuery] = useState<string | null>(null)
  const openId = useOpenBotId()
  const tab = useDetailsTab()
  const groups = rosterGroups(bots, sections)
  const row = (bot: (typeof bots)[number]) => <RosterRow key={bot.id} bot={bot} active={bot.id === openId} tab={tab} />
  const holdsOpen = (list: typeof bots) => list.some(bot => bot.id === openId)
  const sectioned = groups.sections.length > 0

  return (
    <nav aria-label="Bots" className="flex h-full flex-col bg-background">
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
            {groups.top.map(row)}
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
      <RosterFooter connected={connected} />
    </nav>
  )
}
