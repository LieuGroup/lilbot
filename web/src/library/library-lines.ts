/** What the Library screens say and decide (Paper "08 Library"), with no React or network. Pure functions only; times are
 *  in the device's zone. */
import type { LibraryItem, LibraryKind, WorkspaceEntry } from '../../../shared/library-schema'
import { formatBytes } from '../attachments/attachment-rules'
import { clockTime, dayKey, dayLabel, sessionTime } from '../history/history-labels'

/** The filter pills. Pages are listed under Files, with their own icon. */
export const FILTERS = [
  { id: 'all', label: 'All', kinds: undefined },
  { id: 'media', label: 'Media', kinds: ['media'] },
  { id: 'files', label: 'Files', kinds: ['file', 'page'] }
] as const satisfies readonly { id: string; label: string; kinds: readonly LibraryKind[] | undefined }[]
export type LibraryFilter = (typeof FILTERS)[number]['id']

type LibraryGroup = 'Today' | 'This week' | 'Older'

const startOfDay = (at: number) => new Date(at).setHours(0, 0, 0, 0)
/** Monday 00:00 of the week `now` is in. */
const startOfWeek = (now: number) => {
  const date = new Date(startOfDay(now))
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return date.getTime()
}

export function groupOf(at: number, now = Date.now()): LibraryGroup {
  if (dayKey(at) === dayKey(now)) return 'Today'
  return at >= startOfWeek(now) ? 'This week' : 'Older'
}

/** The loaded items in their groups, newest first as the server sent them; empty groups are left out. */
export function groupItems(items: LibraryItem[], now = Date.now()) {
  const groups: { title: LibraryGroup; items: LibraryItem[] }[] = []
  for (const item of items) {
    const title = groupOf(item.createdAt, now)
    const last = groups.at(-1)
    if (last?.title === title) last.items.push(item)
    else groups.push({ title, items: [item] })
  }
  return groups
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** A row's time: "09:14" today, "Mon" this week, "2 Nov" before (with the year for another year). */
export function rowWhen(at: number, now = Date.now()) {
  const group = groupOf(at, now)
  if (group === 'Today') return clockTime(at)
  if (group === 'This week') return WEEKDAYS[new Date(at).getDay()]
  return dayLabel(at, now).split(' ').slice(1).join(' ')
}

/** The viewer's time: "today 09:14", "yesterday 18:02", "Mon 9 Nov 14:20". */
export function fullWhen(at: number, now = Date.now()) {
  const text = sessionTime(at, now)
  return /^(Today|Yesterday) /.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text
}

/** "Image", "Audio", "Video", "Page", the file's extension in capitals ("CSV"), or "File". */
export function kindLabel(item: Pick<LibraryItem, 'kind' | 'mime' | 'path'>) {
  if (item.kind === 'page') return 'Page'
  if (item.kind === 'media') {
    const type = item.mime.split('/')[0]
    return type === 'image' ? 'Image' : type === 'audio' ? 'Audio' : type === 'video' ? 'Video' : 'Media'
  }
  const extension = /\.([a-z0-9]{1,5})$/i.exec(item.path)?.[1]
  return extension ? extension.toUpperCase() : 'File'
}

/** A row's second line: "Image · 412 KB · 09:14", or why it cannot open. */
export function rowLine(item: LibraryItem, now = Date.now()) {
  return item.missing ? 'File no longer in the workspace' : `${kindLabel(item)} · ${formatBytes(item.size)} · ${rowWhen(item.createdAt, now)}`
}

export const viewerLine = (item: LibraryItem, now = Date.now()) => `${kindLabel(item)} · ${formatBytes(item.size)} · ${fullWhen(item.createdAt, now)}`

/** Where it came from, under the viewer. */
export const sourceLine = (item: LibraryItem, now = Date.now()) => `${item.routineRunId ? 'Given by a routine run' : 'Given in the chat'}, ${fullWhen(item.createdAt, now)}`

/** How a row opens: images and pages in the viewer; other files, sound and video included, download. */
export function viewOf(item: Pick<LibraryItem, 'kind' | 'mime' | 'path'>) {
  if (item.kind === 'page') return /\.md$/i.test(item.path) ? 'markdown' : 'html'
  return item.kind === 'media' && item.mime.startsWith('image/') ? 'image' : 'download'
}

/** The file's own name, for saving it. */
export const fileName = (path: string) => path.split('/').at(-1) ?? path

/** The workspace view's path line: "Workspace", then each folder with the path that opens it. */
export function pathParts(path: string) {
  const names = path.split('/').filter(Boolean)
  return [{ name: 'Workspace', path: '' }, ...names.map((name, index) => ({ name, path: names.slice(0, index + 1).join('/') }))]
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
/** "2 folders, 4 files. Working files stay here; only what the bot hands over appears in the Library." */
export function countLine(entries: WorkspaceEntry[]) {
  const folders = entries.filter(entry => entry.directory).length
  const what = entries.length === 0 ? 'Nothing here yet' : `${count(folders, 'folder')}, ${count(entries.length - folders, 'file')}`
  return `${what}. Working files stay here; only what the bot hands over appears in the Library.`
}
