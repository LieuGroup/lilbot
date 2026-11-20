/** How the roster is split into groups. Pure, so the order can be tested without a browser. */
import type { Bot, Section } from '../../../shared/bot-schema'

export interface RosterGroups {
  /** The top of the roster: the primary bot, then pinned bots in the order they were pinned. */
  top: Bot[]
  /** Whether the top shows as tiles: only once a bot is pinned. Alone, the primary is an ordinary row. */
  tiled: boolean
  /** Named sections in the user's order; empty ones are left out. */
  sections: { section: Section; bots: Bot[] }[]
  /** Bots in no section (or in one that no longer exists). */
  unassigned: Bot[]
  hidden: Bot[]
}

const byPinTime = (a: Bot, b: Bot) => (a.prefs.pinnedAt ?? 0) - (b.prefs.pinnedAt ?? 0) || a.name.localeCompare(b.name)

/** A pinned bot leaves its section for the top; a hidden one stays in Hidden, pinned or not.
 *  Otherwise the server's order is kept. */
export function rosterGroups(bots: Bot[], sections: Section[]): RosterGroups {
  const known = new Set(sections.map(section => section.id))
  const rest = bots.filter(bot => !bot.isPrimary)
  const shown = rest.filter(bot => !bot.prefs.hidden)
  const listed = shown.filter(bot => !bot.prefs.pinned)
  const pinned = shown.filter(bot => bot.prefs.pinned).sort(byPinTime)
  return {
    top: [...bots.filter(bot => bot.isPrimary), ...pinned],
    tiled: pinned.length > 0,
    sections: sections.map(section => ({ section, bots: listed.filter(bot => bot.prefs.sectionId === section.id) })).filter(group => group.bots.length > 0),
    unassigned: listed.filter(bot => !bot.prefs.sectionId || !known.has(bot.prefs.sectionId)),
    hidden: rest.filter(bot => bot.prefs.hidden)
  }
}

/** The collapsed rail: the same order as the open roster, one list per group. "Unassigned" and
 *  "Hidden" appear only when they are open there (with no sections, Unassigned is a plain list). */
export function railGroups(groups: RosterGroups, isOpen: (group: 'unassigned' | 'hidden', bots: Bot[]) => boolean): Bot[][] {
  const sectioned = groups.sections.length > 0
  return [
    groups.top,
    ...groups.sections.map(group => group.bots),
    !sectioned || isOpen('unassigned', groups.unassigned) ? groups.unassigned : [],
    isOpen('hidden', groups.hidden) ? groups.hidden : []
  ].filter(list => list.length > 0)
}

/** The search box: every bot whose name or function contains the words, hidden ones too. */
export function searchBots(bots: Bot[], query: string): Bot[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return bots.filter(bot => {
    const text = `${bot.name} ${bot.function}`.toLowerCase()
    return words.every(word => text.includes(word))
  })
}
