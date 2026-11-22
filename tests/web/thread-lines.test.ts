import { expect, test } from 'bun:test'
import type { BotThread, ThreadMessage } from '../../shared/thread-schema'
import type { WorkSummary } from '../../shared/work-schema'
import { activityOrder, activityRow, batchOf, batchSummary, fileCounts, lineState, lineTitle, stopIndex, stripState, taskTitle } from '../../web/src/threads/thread-lines'
import { inlineState, workerActivityRow, workerFooter, workerSubtitle } from '../../web/src/threads/worker-lines'

const MIN = 60_000
const T0 = new Date(2026, 10, 21, 10, 2).getTime()
const lead = { id: 'lead', name: 'FillLight Bot' }
const eng = { id: 'eng', name: 'Server Engineer' }

const message = (authorId: string, text: string, at: number, extra: Partial<ThreadMessage> = {}): ThreadMessage => ({
  id: `${authorId}-${at}`,
  authorId,
  authorName: authorId === 'lead' ? lead.name : eng.name,
  createdAt: at,
  items: [{ kind: 'assistant', text }],
  ...extra
})

const file = (fromId: string) => ({ name: 'export-waits.csv', size: 18_000, fromId, path: 'exchanges/x/a-export-waits.csv' })

function thread(extra: Partial<BotThread> = {}): BotThread {
  return {
    id: 't1',
    participants: [lead, eng],
    createdAt: T0,
    depth: 1,
    state: 'open',
    messages: [message('lead', '## Fix the export queue\nThe numbers are attached.', T0, { files: [file('lead')] })],
    batchId: 'b1',
    parentId: null,
    status: 'working',
    activity: 'Running commands',
    startedAt: T0,
    endedAt: null,
    stoppedBy: null,
    ...extra
  }
}

const now = T0 + 4 * MIN

test('a handed-over task says who, which task and every state, from the delegating side', () => {
  expect(lineTitle(thread(), 'lead')).toBe('Server Engineer · Fix the export queue')
  expect(lineState(thread({ status: 'waiting', startedAt: null }), 'lead', now)).toEqual({ icon: null, text: 'Waiting to start', failed: false, stopped: false })
  expect(lineState(thread(), 'lead', now)).toMatchObject({ icon: 'working', text: 'Running commands · 4 min · 1 file sent' })
  expect(lineState(thread({ activity: null, messages: [message('lead', 'Fix it', T0)] }), 'lead', now).text).toBe('Working · 4 min')
  const redirect = message('lead', 'Also find why', T0 + MIN, { redirect: true })
  const redirected = thread({ redirecting: true, messages: [...thread().messages, redirect] })
  expect(lineState(redirected, 'lead', now)).toMatchObject({ icon: 'working', text: 'Redirected · picks it up at its next step' })
  // Once the redirect reached the running turn the line shows the work again.
  expect(lineState({ ...redirected, redirecting: undefined }, 'lead', now).text).toBe('Running commands · 4 min · 1 file sent')
  const reply = message('eng', 'Done', T0 + 6 * MIN, { files: [file('eng')] })
  const finished = thread({ status: 'finished', activity: null, endedAt: T0 + 6 * MIN, messages: [...thread().messages, reply] })
  expect(lineState(finished, 'lead', now + 60 * MIN)).toMatchObject({ icon: 'finished', text: 'Finished · 6 min · 1 file back' })
  expect(lineState(thread({ status: 'failed', state: 'failed' }), 'lead', now)).toMatchObject({ failed: true, text: 'Failed · Server Engineer could not be reached' })
  const why = thread({ status: 'failed', failure: 'the turn ended in an error' })
  for (const botId of ['lead', 'eng']) expect(lineState(why, botId, now)).toMatchObject({ failed: true, text: 'Failed · the turn ended in an error' })
  expect(stripState(why, now)).toMatchObject({ failed: true, text: 'Failed · the turn ended in an error' })
  expect(activityRow(why, 'lead', now).line).toContain('Failed · the turn ended in an error')
  const byOscar = thread({ status: 'cancelled', endedAt: now, stoppedBy: { kind: 'oscar', id: null, name: 'Oscar', at: now } })
  expect(lineState(byOscar, 'lead', now)).toEqual({ icon: null, text: 'Stopped by you · after 4 min', failed: false, stopped: true })
  const byBot = thread({ status: 'cancelled', stoppedBy: { kind: 'bot', id: 'lead', name: 'FillLight Bot', at: now } })
  expect(lineState(byBot, 'lead', now)).toMatchObject({ text: 'Stopped by FillLight Bot', stopped: true })
})

test('the receiving bot reads "From" with files received and sent back', () => {
  const reply = message('eng', 'Done', T0 + 9 * MIN, { files: [file('eng')] })
  const finished = thread({ status: 'finished', endedAt: T0 + 9 * MIN, messages: [...thread().messages, reply] })
  expect(lineTitle(finished, 'eng')).toBe('From FillLight Bot · Fix the export queue')
  expect(lineState(finished, 'eng', now).text).toBe('Finished · 9 min · 1 file received, 1 sent back')
  expect(lineState(thread({ messages: [message('lead', 'Fix it', T0)] }), 'eng', now).text).toBe('Running commands · 4 min')
  expect(fileCounts(finished)).toEqual({ sent: 1, back: 1 })
})

test('an asked thread keeps the #65 wording', () => {
  const asked = thread({ batchId: null })
  expect(lineTitle(asked, 'lead')).toBe('Asked Server Engineer')
  expect(lineTitle(asked, 'eng')).toBe('FillLight Bot asked this bot')
  expect(lineState(asked, 'lead', now)).toMatchObject({ icon: 'working', text: 'Server Engineer is working on it' })
  const answered = thread({ batchId: null, status: 'finished', messages: [message('lead', 'a', T0), message('eng', 'b', T0), message('lead', 'c', T0), message('eng', 'd', T0)] })
  expect(lineState(answered, 'lead', now).text).toBe('Answered · 4 messages')
  expect(lineState(thread({ batchId: null, status: 'failed', state: 'failed' }), 'lead', now)).toMatchObject({ failed: true, text: 'Could not be delivered' })
  const limited = thread({ batchId: null, status: 'finished', state: 'limited', messages: Array.from({ length: 20 }, (_, i) => message('lead', 'x', T0 + i)) })
  expect(lineState(limited, 'lead', now).text).toBe('Stopped at the 20-message limit')
})

test('a task title is the first line of the request, cut', () => {
  expect(taskTitle(thread({ messages: [message('lead', `\n- ${'x'.repeat(200)}`, T0)] }))).toBe(`${'x'.repeat(119)}…`)
  expect(taskTitle(thread({ messages: [] }))).toBe('Task')
})

test('tasks handed out in one call are one card, in the order they were handed out', () => {
  const a = thread({ id: 'a', createdAt: T0 + 1 })
  const b = thread({ id: 'b', createdAt: T0, status: 'finished' })
  const other = thread({ id: 'c', batchId: 'b2' })
  expect(batchOf([a, other, b], a).map(t => t.id)).toEqual(['b', 'a'])
  expect(batchOf([a], thread({ id: 'd', batchId: null })).map(t => t.id)).toEqual(['d'])
  expect(batchSummary([a, b])).toEqual({ title: 'Handed out 2 tasks', progress: '1 of 2 finished' })
})

test('the opened task strip, and where the stop line falls with greyed late answers after it', () => {
  expect(stripState(thread(), now)).toMatchObject({ icon: 'working', text: 'Working · Running commands · 4 min' })
  const late = message('eng', 'Second worker is up.', now + MIN, { withheld: true })
  const stopped = thread({ status: 'cancelled', stoppedBy: { kind: 'oscar', id: null, name: 'Oscar', at: now }, messages: [...thread().messages, late] })
  expect(stopIndex(stopped)).toBe(1)
  expect(stopIndex({ ...stopped, messages: thread().messages })).toBe(1)
  expect(stopIndex(thread())).toBe(-1)
})

test('the Activity card lists running ones first, then newest, with the state or the date', () => {
  const old = thread({ id: 'old', createdAt: T0 - 2 * 86_400_000, status: 'finished', batchId: null })
  const today = thread({ id: 'today', createdAt: T0 + MIN, status: 'finished' })
  const busy = thread({ id: 'busy', createdAt: T0 - 86_400_000 })
  expect(activityOrder([old, today, busy]).map(t => t.id)).toEqual(['busy', 'today', 'old'])
  expect(activityRow(busy, 'lead', now)).toEqual({ title: 'Handed to Server Engineer', line: 'Working · Fix the export queue' })
  expect(activityRow(today, 'eng', now)).toEqual({ title: 'FillLight Bot handed this bot work', line: 'Today 10:03 · Fix the export queue' })
  expect(activityRow(old, 'lead', now).line).toBe('19 Nov · Fix the export queue')
  const limited = thread({ createdAt: T0 - 86_400_000, batchId: null, status: 'finished', state: 'limited' })
  expect(activityRow(limited, 'lead', now).line).toBe('Yesterday · Stopped at the 1-message limit')
})

test('same-bot workers format titles, file counts, inline records, custom model header, footer and Activity rows', () => {
  const reply = message('lead', 'Fixed backoff.', T0 + 6 * MIN, { fromWorker: true, files: [file('lead')] })
  const worker = thread({
    participants: [lead, lead],
    worker: true,
    model: { provider: 'anthropic', model: 'Opus 5.5' },
    reasoningEffort: 'high',
    messages: [message('lead', 'Fix the export retry backoff', T0, { files: [file('lead')] }), reply]
  })
  expect(lineTitle(worker, 'lead')).toBe('Worker · Fix the export retry backoff')
  expect(fileCounts(worker)).toEqual({ sent: 1, back: 1 })
  expect(batchSummary([worker, { ...worker, id: 't2', status: 'finished' }])).toEqual({ title: 'Started 2 workers', progress: '1 of 2 finished' })
  expect(batchSummary([worker, thread()])).toEqual({ title: 'Handed out 2 tasks', progress: '0 of 2 finished' })
  expect(inlineState(worker)).toEqual({ icon: null, text: 'Started 10:02', failed: false, stopped: false })
  expect(inlineState({ ...worker, status: 'finished' })).toEqual({ icon: 'finished', text: 'Finished', failed: false, stopped: false })
  expect(inlineState({ ...worker, status: 'cancelled', stoppedBy: { kind: 'oscar', id: null, name: 'Oscar', at: now } })).toMatchObject({ text: 'Stopped by you', stopped: true })
  expect(inlineState({ ...worker, status: 'failed' })).toEqual({ icon: null, text: 'Failed', failed: true, stopped: false })
  // Header shows custom model/effort only when different from the bot's own.
  expect(workerSubtitle(worker, { provider: 'anthropic', model: 'Sonnet 5.5' }, 'medium')).toBe("FillLight Bot's worker · Opus 5.5 · high")
  expect(workerSubtitle(worker, { provider: 'anthropic', model: 'Opus 5.5' }, 'high')).toBe("FillLight Bot's worker")
  expect(workerSubtitle({ ...worker, model: undefined, reasoningEffort: undefined }, { provider: 'anthropic', model: 'Sonnet 5.5' }, 'medium')).toBe("FillLight Bot's worker")
  expect(workerSubtitle(worker, undefined, undefined)).toBe("FillLight Bot's worker · Opus 5.5 · high")
  expect(workerFooter(worker)).toBe('You watch this worker. To steer it, tell FillLight Bot in its chat.')
  expect(workerFooter({ ...worker, status: 'finished' })).toBe('This worker finished. Follow up with FillLight Bot in its chat.')
  expect(workerFooter({ ...worker, status: 'cancelled' })).toBe('This worker stopped. Follow up with FillLight Bot in its chat.')
  expect(workerFooter({ ...worker, status: 'failed' })).toBe('This worker failed. Follow up with FillLight Bot in its chat.')
  // Activity card "Workers" row.
  expect(workerActivityRow(worker, now)).toMatchObject({ title: 'Fix the export retry backoff', state: { icon: 'working', text: 'Running commands · 4 min · 1 file sent' } })
  expect(workerActivityRow({ ...worker, status: 'finished', endedAt: T0 + 6 * MIN }, now)).toEqual({
    title: 'Fix the export retry backoff',
    state: { icon: 'finished', text: 'Today 10:08', failed: false, stopped: false }
  })
  const waiting: WorkSummary = {
    id: worker.id,
    title: 'Fix the export retry backoff',
    ownerId: 'lead',
    ownerName: 'FillLight Bot',
    askedBy: { kind: 'self', id: 'lead', name: 'FillLight Bot' },
    origin: { kind: 'exchange', id: worker.id },
    parentId: null,
    goalId: null,
    kind: 'code',
    checkLevel: 1,
    defaultLevel: 1,
    check: null,
    status: 'needs_oscar',
    question: 'Confirm empty-file behavior',
    evidenceCount: 0,
    createdAt: T0,
    updatedAt: now,
    startedAt: T0,
    finishedAt: null
  }
  expect(workerActivityRow({ ...worker, status: 'finished' }, now, waiting).state).toMatchObject({ icon: 'waiting', text: 'Waiting for you · Confirm empty-file behavior' })
  expect(inlineState({ ...worker, status: 'finished' }, waiting)).toEqual({ icon: 'waiting', text: 'Waiting for you', failed: false, stopped: false })
  expect(stripState({ ...worker, status: 'finished' }, now, waiting)).toMatchObject({ icon: 'waiting', text: 'Waiting for you · Confirm empty-file behavior' })
  expect(batchSummary([worker, { ...worker, id: 't2', status: 'finished' }], { t2: { ...waiting, id: 't2', origin: { kind: 'exchange', id: 't2' } } })).toEqual({
    title: 'Started 2 workers',
    progress: '0 of 2 finished'
  })
})
