/** Settings > Memory on the phone, as plain rules: which page a pushed `[section]` route shows, its title, the
 *  first shared facts before "Show N more", the bots that know facts of their own, and the Duo strip for each page.
 *  Zero React Native imports so Linux tests check every rule. */
import { MEMORY_TITLES } from '../../../shared/client/memory/memory-lines'
import type { Bot } from '../../../shared/bot-schema'
import type { MemoryBot, MemoryFact } from '../../../shared/memory-schema'
import type { DuoStripScreen } from '../duo/vertical-bar'

/** The pages of Memory. Each one past the first is the same `[section]` route pushed again with its own params,
 *  so Back, the edge swipe and the Duo strip's Back all return one page. */
export type MemoryRoute = { view: 'main' } | { view: 'bot'; botId: string; name: string } | { view: 'removed' } | { view: 'fact'; factId: string }

type RouteParams = Record<string, string | string[] | undefined>

const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '')

export function memoryRoute(params: RouteParams): MemoryRoute {
  const view = one(params.view)
  if (view === 'bot' && one(params.botId)) return { view, botId: one(params.botId), name: one(params.name) }
  if (view === 'removed') return { view }
  if (view === 'fact' && one(params.factId)) return { view, factId: one(params.factId) }
  return { view: 'main' }
}

/** Params that push `route` on top of Memory: `{ section: 'memory', ... }` for the `[section]` route. */
export function memoryRouteParams(route: MemoryRoute): Record<string, string> {
  if (route.view === 'bot') return { section: 'memory', view: 'bot', botId: route.botId, name: route.name }
  if (route.view === 'fact') return { section: 'memory', view: 'fact', factId: route.factId }
  return route.view === 'removed' ? { section: 'memory', view: 'removed' } : { section: 'memory' }
}

export function memoryTitle(route: MemoryRoute, botName = ''): string {
  if (route.view === 'bot') return botName || route.name || 'Memory'
  return route.view === 'removed' ? MEMORY_TITLES.removed : 'Memory'
}

/** "Memory › Shared with all your bots" over an opened fact on the Duo. */
export const factBreadcrumb = (fact: MemoryFact) => ['Memory', fact.scope === 'shared' ? MEMORY_TITLES.shared : MEMORY_TITLES.oneBot] as const

/** Shared facts shown before "Show N more". */
export const FIRST_SHARED = 5

/** The shared facts on screen and how many still wait behind "Show N more" (counted from the page's total). */
export function sharedShown(facts: MemoryFact[], total: number, expanded: boolean): { shown: MemoryFact[]; hidden: number } {
  const shown = expanded ? facts : facts.slice(0, FIRST_SHARED)
  return { shown, hidden: Math.max(0, total - shown.length) }
}

/** "Known by one bot only": bots with facts of their own, by name; the section's count is their sum. */
export function factOwners(bots: MemoryBot[]): { owners: MemoryBot[]; total: number } {
  const owners = bots.filter(bot => bot.facts > 0).sort((a, b) => a.name.localeCompare(b.name))
  return { owners, total: owners.reduce((sum, bot) => sum + bot.facts, 0) }
}

/** The Duo side strip for each page: Search and Add on Memory, Pause and Forget on an opened fact, Back alone elsewhere. */
export function memoryStripScreen(route: MemoryRoute): DuoStripScreen | null {
  if (route.view === 'main') return 'memory'
  return route.view === 'fact' ? 'memory-fact' : null
}


/** Who a new fact is saved under: a shared fact under the primary bot (as on the web), a one-bot fact under the chosen bot. */
export function newFactOwner(bots: Bot[], shared: boolean, chosen: string): string {
  const primary = bots.find(bot => bot.isPrimary) ?? bots[0]
  return shared ? (primary?.id ?? chosen) : chosen || primary?.id || ''
}
