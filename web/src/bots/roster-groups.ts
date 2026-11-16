/** How the roster is split into groups. Pure, so the order can be tested without a browser. */
import type { Bot, Section } from '../../../shared/bot-schema'

export interface RosterGroups {
  /** The primary bot, with no label above it. */
  top: Bot[]
  /** Named sections in the user's order; empty ones are left out. */
  sections: { section: Section; bots: Bot[] }[]
  /** Bots in no section (or in one that no longer exists). */
  unassigned: Bot[]
  hidden: Bot[]
}

/** Pinned bots come first inside their group; otherwise the server's order is kept. */
const pinnedFirst = (bots: Bot[]) => [...bots].sort((a, b) => Number(b.prefs.pinned) - Number(a.prefs.pinned))

export function rosterGroups(bots: Bot[], sections: Section[]): RosterGroups {
  const known = new Set(sections.map(section => section.id))
  const rest = bots.filter(bot => !bot.isPrimary)
  const shown = rest.filter(bot => !bot.prefs.hidden)
  return {
    top: bots.filter(bot => bot.isPrimary),
    sections: sections.map(section => ({ section, bots: pinnedFirst(shown.filter(bot => bot.prefs.sectionId === section.id)) })).filter(group => group.bots.length > 0),
    unassigned: pinnedFirst(shown.filter(bot => !bot.prefs.sectionId || !known.has(bot.prefs.sectionId))),
    hidden: pinnedFirst(rest.filter(bot => bot.prefs.hidden))
  }
}

/** The search box: every bot whose name or function contains the words, hidden ones too. */
export function searchBots(bots: Bot[], query: string): Bot[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return bots.filter(bot => {
    const text = `${bot.name} ${bot.function}`.toLowerCase()
    return words.every(word => text.includes(word))
  })
}
