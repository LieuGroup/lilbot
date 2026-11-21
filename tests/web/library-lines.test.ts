import { expect, test } from 'bun:test'
import type { LibraryItem } from '../../shared/library-schema'
import { countLine, fullWhen, groupItems, groupOf, kindLabel, pathParts, rowLine, rowWhen, sourceLine, viewOf } from '../../web/src/library/library-lines'

// Wednesday 18 November 2026, 10:00 on the device's clock.
const now = new Date(2026, 10, 18, 10, 0).getTime()
const at = (day: number, hour = 9, minute = 14, month = 10, year = 2026) => new Date(year, month, day, hour, minute).getTime()
const item = (patch: Partial<LibraryItem>): LibraryItem => ({
  id: 'i',
  botId: 'b',
  title: 'T',
  path: 'numbers.csv',
  kind: 'file',
  size: 6 * 1024,
  createdAt: at(18),
  chatId: 'c',
  routineRunId: null,
  missing: false,
  mime: 'text/csv',
  url: '/api/library/b/i',
  ...patch
})

test('groups by local day and the Monday-start week', () => {
  expect(groupOf(at(18, 0, 1), now)).toBe('Today')
  expect(groupOf(at(16, 0, 0), now)).toBe('This week')
  expect(groupOf(at(15, 23, 59), now)).toBe('Older')
  const groups = groupItems([item({ id: 'a' }), item({ id: 'b', createdAt: at(17) }), item({ id: 'c', createdAt: at(16) }), item({ id: 'd', createdAt: at(2) })], now)
  expect(groups.map(group => [group.title, group.items.map(entry => entry.id)])).toEqual([
    ['Today', ['a']],
    ['This week', ['b', 'c']],
    ['Older', ['d']]
  ])
})

test('times: the row is short, the viewer full', () => {
  expect([rowWhen(at(18), now), rowWhen(at(16), now), rowWhen(at(2), now), rowWhen(at(2, 9, 14, 10, 2025), now)]).toEqual(['09:14', 'Mon', '2 Nov', '2 Nov 2025'])
  expect([fullWhen(at(18), now), fullWhen(at(17, 18, 2), now), fullWhen(at(2), now)]).toEqual(['today 09:14', 'yesterday 18:02', 'Mon 2 Nov 09:14'])
})

test('kind labels, lines and how an item opens', () => {
  const image = item({ kind: 'media', mime: 'image/png', path: 'shot.png', size: 412 * 1024 })
  expect(rowLine(image, now)).toBe('Image · 412 KB · 09:14')
  expect(rowLine(item({}), now)).toBe('CSV · 6 KB · 09:14')
  expect(rowLine(item({ missing: true }), now)).toBe('File no longer in the workspace')
  expect([kindLabel(item({ kind: 'page', path: 'a.md' })), kindLabel(item({ path: 'README' })), kindLabel(item({ kind: 'media', mime: 'audio/mpeg' }))]).toEqual([
    'Page',
    'File',
    'Audio'
  ])
  expect([viewOf(image), viewOf(item({})), viewOf(item({ kind: 'page', path: 'Notes.MD' })), viewOf(item({ kind: 'page', path: 'a.html' }))]).toEqual([
    'image',
    'download',
    'markdown',
    'html'
  ])
  expect(sourceLine(item({}), now)).toBe('Given in the chat, today 09:14')
  expect(sourceLine(item({ routineRunId: 'r', chatId: 'x' }), now)).toBe('Given by a routine run, today 09:14')
})

test('workspace path and count lines', () => {
  expect(pathParts('raw/2026')).toEqual([
    { name: 'Workspace', path: '' },
    { name: 'raw', path: 'raw' },
    { name: '2026', path: 'raw/2026' }
  ])
  expect(pathParts('')).toEqual([{ name: 'Workspace', path: '' }])
  const entry = (directory: boolean) => ({ name: 'x', directory, size: 1 })
  expect(countLine([entry(true), entry(true), entry(false), entry(false), entry(false), entry(false)])).toStartWith('2 folders, 4 files. Working files stay here')
  expect(countLine([entry(true), entry(false)])).toStartWith('1 folder, 1 file.')
  expect(countLine([])).toStartWith('Nothing here yet.')
})
