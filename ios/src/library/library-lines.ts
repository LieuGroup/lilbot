/** Pure Library grouping, filter, and path helpers mirroring `web/src/library/library-lines.ts`. */
import type { LibraryItem, LibraryKind, WorkspaceEntry } from '../../../shared/library-schema'
import { clockTime, dayKey, dayLabel, formatBytes, sessionTime } from '../ui/format-time'

export const LIBRARY_FILTERS = [
  { id: 'all', label: 'All', kinds: undefined },
  { id: 'media', label: 'Media', kinds: ['media'] },
  { id: 'files', label: 'Files', kinds: ['file', 'page'] }
] as const satisfies readonly { id: string; label: string; kinds: readonly LibraryKind[] | undefined }[]

export type LibraryFilter = (typeof LIBRARY_FILTERS)[number]['id']
export type LibraryGroup = 'Today' | 'This week' | 'Older'

const startOfDay = (at: number) => new Date(at).setHours(0, 0, 0, 0)
const startOfWeek = (now: number) => {
  const date = new Date(startOfDay(now))
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return date.getTime()
}

export function groupOf(at: number, now = Date.now()): LibraryGroup {
  if (dayKey(at) === dayKey(now)) return 'Today'
  return at >= startOfWeek(now) ? 'This week' : 'Older'
}

export function groupLibraryItems(items: readonly LibraryItem[], now = Date.now()): { label: LibraryGroup; items: LibraryItem[] }[] {
  const order: LibraryGroup[] = ['Today', 'This week', 'Older']
  const buckets: Record<LibraryGroup, LibraryItem[]> = { Today: [], 'This week': [], Older: [] }
  for (const item of items) buckets[groupOf(item.createdAt, now)].push(item)
  return order.filter(label => buckets[label].length > 0).map(label => ({ label, items: buckets[label] }))
}

export function libraryRowMeta(item: LibraryItem, now = Date.now()): string {
  const when = dayKey(item.createdAt) === dayKey(now) ? clockTime(item.createdAt) : dayLabel(item.createdAt, now)
  return item.missing ? `Missing · ${when}` : `${formatBytes(item.size)} · ${when}`
}

export function librarySourceLine(item: LibraryItem, now = Date.now()): string {
  return `${item.routineRunId ? 'Given by a routine run' : 'Given in the chat'}, ${sessionTime(item.createdAt, now)}`
}

export function viewOf(item: Pick<LibraryItem, 'kind' | 'mime' | 'path'>): 'markdown' | 'html' | 'image' | 'download' {
  if (item.kind === 'page') return /\.md$/i.test(item.path) ? 'markdown' : 'html'
  return item.kind === 'media' && item.mime.startsWith('image/') ? 'image' : 'download'
}

export const fileName = (path: string) => path.split('/').at(-1) ?? path

export function pathParts(path: string): { name: string; path: string }[] {
  const names = path.split('/').filter(Boolean)
  return [{ name: 'Workspace', path: '' }, ...names.map((name, index) => ({ name, path: names.slice(0, index + 1).join('/') }))]
}

const countWord = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

export function countLine(entries: readonly WorkspaceEntry[]): string {
  const folders = entries.filter(entry => entry.directory).length
  const what = entries.length === 0 ? 'Nothing here yet' : `${countWord(folders, 'folder')}, ${countWord(entries.length - folders, 'file')}`
  return `${what}. Working files stay here; only what the bot hands over appears in the Library.`
}
