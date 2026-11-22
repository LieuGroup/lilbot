/** Pure derivation for the composer-top tasks dock (Paper "22 Workers" frames 1-4 and Notes): which tasks are in flight or
 *  need attention, their explicit order, batch grouping, 2-minute finished expiry, and expanded/collapsed summaries. */
import type { BotThread } from '../../../shared/thread-schema'
import type { WorkSummary } from '../../../shared/work-schema'
import { isWorker, joined, type LineState, lineState, otherName, plural, running, sides, taskTitle } from './thread-lines'
import { isOpenOscarCheck } from './worker-lines'

/** Finished rows stay in the dock for 2 minutes (or until opened or dismissed), then leave automatically. */
export const FINISHED_TTL_MS = 2 * 60_000

type DockKind = 'waiting_oscar' | 'running' | 'failed' | 'finished'

export interface DockItem {
  thread: BotThread
  kind: DockKind
  /** Stamp used for dismissal so a later continuation of the same exchange reappears cleanly. */
  stamp: number
  /** Present when `kind === 'waiting_oscar'`. */
  waiting?: WorkSummary
  /** True when Oscar can answer a question directly (versus an open level-3 check). */
  canAnswer: boolean
}

export type DockEntry = { kind: 'single'; item: DockItem } | { kind: 'batch'; batchId: string; title: string; progress: string; allWorkers: boolean; items: DockItem[] }

const PRIORITY: Record<DockKind, number> = { waiting_oscar: 0, running: 1, failed: 2, finished: 3 }

const isNeedsOscar = (work: WorkSummary | undefined) => work?.status === 'needs_oscar'

/** Classifies one exchange for `botId`'s dock, or null if it does not belong in the dock now. */
function classifyDockItem(thread: BotThread, botId: string, waiting: WorkSummary | undefined, dismissedAt: number | undefined, now: number): DockItem | null {
  if (thread.group || sides(thread).from.id !== botId) return null
  if (thread.status === 'cancelled') return null
  if (thread.state === 'limited' && !running(thread)) return null
  const stamp = thread.endedAt ?? thread.createdAt
  if (isNeedsOscar(waiting)) return { thread, kind: 'waiting_oscar', stamp: waiting!.updatedAt, waiting, canAnswer: !isOpenOscarCheck(waiting) }
  if (running(thread)) return { thread, kind: 'running', stamp: thread.createdAt, canAnswer: false }
  if (thread.status === 'failed' || thread.state === 'failed') {
    if (dismissedAt !== undefined && dismissedAt >= stamp) return null
    return { thread, kind: 'failed', stamp, canAnswer: false }
  }
  if (thread.status === 'finished') {
    if (dismissedAt !== undefined && dismissedAt >= stamp) return null
    if (now - stamp >= FINISHED_TTL_MS) return null
    return { thread, kind: 'finished', stamp, canAnswer: false }
  }
  return null
}

function compareItems(a: DockItem, b: DockItem): number {
  const byKind = PRIORITY[a.kind] - PRIORITY[b.kind]
  if (byKind !== 0) return byKind
  if (a.kind === 'running' && b.kind === 'running') {
    const byStatus = Number(b.thread.status === 'working') - Number(a.thread.status === 'working')
    if (byStatus !== 0) return byStatus
  }
  const timeA = a.kind === 'running' ? a.thread.createdAt : a.stamp
  const timeB = b.kind === 'running' ? b.thread.createdAt : b.stamp
  return timeB - timeA || a.thread.id.localeCompare(b.thread.id)
}

/** Sorted dock items for `botId`. Never assumes server list order. */
export function dockItems(threads: BotThread[], botId: string, waitingWork: Record<string, WorkSummary>, dismissed: Record<string, number>, now: number): DockItem[] {
  const items: DockItem[] = []
  for (const thread of threads) {
    const item = classifyDockItem(thread, botId, waitingWork[thread.id], dismissed[thread.id], now)
    if (item) items.push(item)
  }
  return items.sort(compareItems)
}

/** Groups visible dock items that share a `batchId` (when at least 2 from that batch are visible), keeping explicit priority order. */
export function dockEntries(items: DockItem[], allThreads: BotThread[], botId: string, waitingWork: Record<string, WorkSummary> = {}): DockEntry[] {
  const byBatch = new Map<string, DockItem[]>()
  for (const item of items) {
    const id = item.thread.batchId
    if (!id) continue
    const list = byBatch.get(id) ?? []
    list.push(item)
    byBatch.set(id, list)
  }
  const emitted = new Set<string>()
  const entries: DockEntry[] = []
  for (const item of items) {
    const id = item.thread.batchId
    const group = id ? byBatch.get(id) : undefined
    if (!id || !group || group.length < 2) {
      entries.push({ kind: 'single', item })
      continue
    }
    if (emitted.has(id)) continue
    emitted.add(id)
    const full = allThreads.filter(thread => !thread.group && sides(thread).from.id === botId && thread.batchId === id)
    const total = Math.max(full.length, group.length)
    const finished = full.filter(thread => thread.status === 'finished' && waitingWork[thread.id]?.status !== 'needs_oscar').length
    const allWorkers = (full.length ? full : group.map(entry => entry.thread)).every(isWorker)
    entries.push({
      kind: 'batch',
      batchId: id,
      title: allWorkers ? `Started ${plural(total, 'worker')}` : `Handed out ${plural(total, 'task')}`,
      progress: `${finished} of ${total} finished`,
      allWorkers,
      items: group
    })
  }
  return entries
}

/** The dock row's title: omits the redundant "Worker · " prefix inside an all-worker batch (Frame 3). */
export function dockRowTitle(item: DockItem, botId: string, inWorkerBatch: boolean): string {
  const title = taskTitle(item.thread)
  if (item.thread.worker) return inWorkerBatch ? title : `Worker · ${title}`
  return `${otherName(item.thread, botId)} · ${title}`
}

/** The dock row's 12px state line. */
export function dockRowState(item: DockItem, botId: string, now: number): LineState {
  if (item.kind === 'waiting_oscar') {
    const text = item.canAnswer ? joined('Waiting for you', item.waiting?.question) : 'Waiting for your check'
    return { icon: 'waiting', text, failed: false, stopped: false }
  }
  const base = lineState(item.thread, botId, now)
  if (item.kind === 'failed') return { ...base, icon: 'failed', failed: true }
  return base
}

/** Counts by bucket for the dock header and collapsed bar. */
function countsOf(items: DockItem[]) {
  let waiting = 0
  let active = 0
  let failed = 0
  let finished = 0
  for (const item of items) {
    if (item.kind === 'waiting_oscar') waiting++
    else if (item.kind === 'running') active++
    else if (item.kind === 'failed') failed++
    else finished++
  }
  const icon: LineState['icon'] = waiting > 0 ? 'waiting' : active > 0 ? 'working' : failed > 0 ? 'failed' : 'finished'
  return { total: items.length, waiting, running: active, failed, finished, icon }
}

/** Expanded dock header: "1 running", "3 tasks · 2 running", "2 tasks · 1 waiting for you · 1 failed". */
export function dockHeaderSummary(items: DockItem[]): { icon: LineState['icon']; text: string } {
  const { total, waiting, running: active, failed, finished, icon } = countsOf(items)
  if (active === total) return { icon, text: `${active} running` }
  if (waiting === total) return { icon, text: `${waiting} waiting for you` }
  if (failed === total) return { icon, text: `${failed} failed` }
  if (finished === total) return { icon, text: `${finished} finished` }
  return {
    icon,
    text: joined(plural(total, 'task'), waiting > 0 && `${waiting} waiting for you`, active > 0 && `${active} running`, failed > 0 && `${failed} failed`)
  }
}

/** Collapsed dock bar: bold lead ("2 running") + muted detail ("1 finished · Worker, Server Engineer"). */
export function dockCollapsedSummary(items: DockItem[], botId: string): { icon: LineState['icon']; lead: string; detail: string } {
  const { waiting, running: active, failed, finished, icon } = countsOf(items)
  const lead = waiting > 0 ? `${waiting} waiting for you` : active > 0 ? `${active} running` : failed > 0 ? `${failed} failed` : `${finished} finished`
  const extra = [
    waiting > 0 && active > 0 && `${active} running`,
    (waiting > 0 || active > 0) && failed > 0 && `${failed} failed`,
    (waiting > 0 || active > 0 || failed > 0) && finished > 0 && `${finished} finished`
  ]
  const actors: string[] = []
  for (const item of items) {
    const label = item.thread.worker ? 'Worker' : otherName(item.thread, botId)
    if (!actors.includes(label)) actors.push(label)
  }
  return { icon, lead, detail: joined(...extra, actors.join(', ')) }
}

/** Soonest timestamp when a finished dock item expires (or null if none are waiting to expire). */
export function nextDockExpiryAt(items: DockItem[]): number | null {
  let soonest: number | null = null
  for (const item of items) {
    if (item.kind !== 'finished') continue
    const at = item.stamp + FINISHED_TTL_MS
    if (soonest === null || at < soonest) soonest = at
  }
  return soonest
}
