/** iPhone and Duo: received tasks in the dock, the pill's wording per posture, and the roster row count (#316). */
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { rosterRowDisplay, sameRosterBotDisplay } from '../../ios/src/bots/roster-state'
import { buildDockPillModel, compactDockWording } from '../../ios/src/threads/dock-pill'
import { rowState } from '../../shared/client/bots/row-state'
import { dockHeaderSummary, dockItems } from '../../shared/client/threads/dock-items'
import type { BotThread } from '../../shared/thread-schema'
import type { WorkSummary } from '../../shared/work-schema'
import { testBot as bot } from '../web/test-bot'

const MIN = 60_000
const T0 = new Date(2026, 10, 26, 14, 0).getTime()
const cos = { id: 'cos', name: 'Chief of Staff' }
const eng = { id: 'eng', name: 'Engineer' }
const srv = { id: 'srv', name: 'Server Engineer' }
const now = T0 + 34 * MIN

const task = (id: string, from: typeof cos, to: typeof cos, extra: Partial<BotThread> = {}): BotThread => ({
  id,
  participants: [from, to],
  createdAt: T0,
  depth: 1,
  state: 'open',
  messages: [{ id: `m-${id}`, authorId: from.id, authorName: from.name, createdAt: T0, items: [{ kind: 'assistant', text: `Task ${id}` }] }],
  batchId: `batch-${id}`,
  parentId: null,
  status: 'working',
  activity: 'Running commands',
  startedAt: T0,
  endedAt: null,
  stoppedBy: null,
  ...extra
})

const asked = (id: string): WorkSummary => ({
  id,
  title: `Task ${id}`,
  ownerId: eng.id,
  ownerName: eng.name,
  askedBy: { kind: 'bot', id: cos.id, name: cos.name },
  origin: { kind: 'exchange', id },
  parentId: null,
  goalId: null,
  kind: 'figure',
  checkLevel: 2,
  defaultLevel: 2,
  check: null,
  status: 'needs_oscar',
  question: 'Same dock or live lines?',
  evidenceCount: 0,
  createdAt: T0,
  updatedAt: T0 + MIN,
  startedAt: T0,
  finishedAt: null
})

// The postures the design covers (points): iPhone, Duo folded and unfolded, portrait and landscape.
const POSTURES = {
  iphonePortrait: { width: 390, height: 844 },
  iphoneLandscape: { width: 844, height: 390 },
  duoFoldedPortrait: { width: 466, height: 678 },
  duoFoldedLandscape: { width: 678, height: 466 },
  duoUnfoldedPortrait: { width: 669, height: 951 },
  duoUnfoldedLandscape: { width: 951, height: 669 }
}

test('only phone-width portrait postures take the short wording', () => {
  expect(Object.entries(POSTURES).map(([name, size]) => [name, compactDockWording(size)])).toEqual([
    ['iphonePortrait', true],
    ['iphoneLandscape', false],
    ['duoFoldedPortrait', true],
    ['duoFoldedLandscape', false],
    ['duoUnfoldedPortrait', false],
    ['duoUnfoldedLandscape', false]
  ])
})

test('the pill on the receiver: received only, two senders, and both kinds in each posture', () => {
  const first = task('first', cos, eng)
  const second = task('second', cos, eng, { createdAt: T0 + 22 * MIN, startedAt: T0 + 22 * MIN })
  const received = dockItems([first, second], eng.id, {}, {}, now)
  expect(buildDockPillModel(received, eng.id)).toMatchObject({ icon: 'working', lead: '2 running', detail: 'for Chief of Staff', answerTarget: null })
  expect(buildDockPillModel(received, eng.id, true)).toMatchObject({ lead: '2 running', detail: 'for Chief of Staff' })

  const twoBots = dockItems([first, task('other', srv, eng)], eng.id, {}, {}, now)
  expect(buildDockPillModel(twoBots, eng.id)).toMatchObject({ lead: '2 running', detail: 'for 2 bots' })

  const handed = task('handed', eng, srv)
  const both = dockItems([first, second, handed], eng.id, {}, {}, now)
  expect(buildDockPillModel(both, eng.id)).toMatchObject({ icon: 'working', lead: '2 for Chief of Staff', detail: '1 handed out' })
  expect(buildDockPillModel(both, eng.id, true)).toMatchObject({ icon: 'working', lead: '3 running', detail: '' })
  // The open dock's header reads the same words as the pill in each posture.
  expect(dockHeaderSummary(both).text).toBe('2 for Chief of Staff · 1 handed out')
  expect(dockHeaderSummary(both, true).text).toBe('3 running')
})

test('a waiting received task keeps the 1-tap Answer pill and its bubble; the header counts it once', () => {
  const first = task('first', cos, eng)
  const waiting = task('asked', cos, eng, { status: 'finished', endedAt: T0 + 10 * MIN })
  const items = dockItems([first, waiting, task('handed', eng, srv)], eng.id, { asked: asked('asked') }, {}, now)
  const pill = buildDockPillModel(items, eng.id)
  expect(pill).toMatchObject({ icon: 'waiting', lead: '3 · Same dock or live lines?' })
  expect(pill?.answerTarget?.title).toBe('Task asked')
  expect(dockHeaderSummary(items)).toEqual({ icon: 'waiting', text: '2 for Chief of Staff (1 waiting for you) · 1 handed out' })
  expect(dockHeaderSummary(items, true)).toEqual({ icon: 'waiting', text: '1 waiting for you · 2 running' })
})

test("the handing-out bot's pill is unchanged in every posture", () => {
  const items = dockItems([task('first', cos, eng), task('second', cos, eng)], cos.id, {}, {}, now)
  for (const size of Object.values(POSTURES)) expect(buildDockPillModel(items, cos.id, compactDockWording(size))).toMatchObject({ lead: '2 running', detail: 'Engineer' })
})

test('the roster row redraws when the count or a sender changes, and reads the count', () => {
  const working = { activity: { status: 'working' as const, text: 'Running commands' } }
  const one = { ...bot('eng', working), workingFor: { threadId: 'a', name: 'Chief of Staff' }, tasksFor: [{ threadId: 'a', botId: 'cos', name: 'Chief of Staff' }] }
  const two = { ...one, tasksFor: [...one.tasksFor, { threadId: 'b', botId: 'cos', name: 'Chief of Staff' }] }
  const mixed = { ...one, tasksFor: [...one.tasksFor, { threadId: 'b', botId: 'srv', name: 'Server Engineer' }] }
  expect(sameRosterBotDisplay(one, { ...one, tasksFor: [...one.tasksFor] })).toBe(true)
  expect(sameRosterBotDisplay(one, two)).toBe(false)
  expect(sameRosterBotDisplay(two, mixed)).toBe(false)
  expect(rowState(two).text).toBe('For Chief of Staff · 2 tasks')
  expect(rowState(mixed).text).toBe('For 2 bots · 2 tasks')
})

test('the iPhone dock groups rows under labels and passes the posture to the pill and header', () => {
  const source = readFileSync(resolve(import.meta.dir, '../../ios/src/threads/task-dock.tsx'), 'utf8')
  expect(source).toContain('dockSections(items)')
  expect(source).toContain('<DockSectionLabel label={section.label} />')
  expect(source).toContain('buildDockPillModel(items, botId, compact)')
  expect(source).toContain('dockHeaderSummary(items, compact)')
})

test('the iPhone roster row keeps the count as a tail and the row cuts only the name', () => {
  const working = { activity: { status: 'working' as const, text: 'Running commands' } }
  const task = (threadId: string, botId: string, name: string) => ({ threadId, botId, name })
  const two = { ...bot('eng', working), tasksFor: [task('a', 'cos', 'Chief of Staff'), task('b', 'cos', 'Chief of Staff')] }
  expect(rosterRowDisplay(two)).toMatchObject({ inlineText: 'For Chief of Staff · 2 tasks', inlineTail: ' · 2 tasks' })
  expect(rosterRowDisplay(two).accessibilityLabel).toContain('For Chief of Staff · 2 tasks')
  const one = { ...bot('eng', working), workingFor: { threadId: 'a', name: 'Chief of Staff' }, tasksFor: [task('a', 'cos', 'Chief of Staff')] }
  expect(rosterRowDisplay(one).inlineTail).toBeNull()
  const row = readFileSync(resolve(import.meta.dir, '../../ios/src/bots/roster-row.tsx'), 'utf8')
  expect(row).toContain('<RowPreview display={display}')
  expect(row).toContain('text(display.inlineTail, { flexShrink: 0 })')
})
