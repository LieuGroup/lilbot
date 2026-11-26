/** Pure Bot Details tab list and helpers.
 *  Memory lives in one place only (Settings -> Memory, owned by LILA-54), so Bot Details shows
 *  exactly three tabs: Activity, Library, and Setup. */
export const BOT_DETAILS_TABS = [
  { id: 'activity', label: 'Activity' },
  { id: 'library', label: 'Library' },
  { id: 'setup', label: 'Setup' }
] as const

export type BotDetailsTab = (typeof BOT_DETAILS_TABS)[number]['id']

export function normalizeBotDetailsTab(value: string | undefined): BotDetailsTab {
  if (value === 'library' || value === 'setup' || value === 'activity') return value
  return 'activity'
}
