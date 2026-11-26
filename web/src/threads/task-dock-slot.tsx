import { lazy, Suspense } from 'react'
import type { BotThread } from '../../../shared/thread-schema'
import type { WorkSummary } from '../../../shared/work-schema'
import { useDismissed, useThreads, useWaitingWork } from './thread-store'

const TaskDock = lazy(() => import('./task-dock'))
const FINISHED_TTL_MS = 2 * 60_000

/** Lightweight first-load check mirroring `dock-items.ts` so the dock and thread-line modules stay lazy until needed. */
function anyInDock(threads: BotThread[] | undefined, botId: string, waiting: Record<string, WorkSummary>, dismissed: Record<string, number>, now: number) {
  if (!threads?.length) return false
  return threads.some(thread => {
    if (thread.group || thread.status === 'cancelled') return false
    // Tasks it handed out (and its workers), or since #316 a task another bot handed it.
    const [from, to] = thread.participants
    if (from?.id !== botId && (thread.worker || to?.id !== botId)) return false
    const active = thread.status === 'waiting' || thread.status === 'working'
    if (thread.state === 'limited' && !active) return false
    if (waiting[thread.id]?.status === 'needs_oscar' || active) return true
    const stamp = thread.endedAt ?? thread.createdAt
    const gone = dismissed[thread.id]
    if (gone !== undefined && gone >= stamp) return false
    if (thread.status === 'failed' || thread.state === 'failed') return true
    return thread.status === 'finished' && now - stamp < FINISHED_TTL_MS
  })
}

/** First-load gate for the composer-top tasks dock: watches `threads.list` and loads the dock chunk only once this bot has
 *  an in-flight, waiting, failed or recently finished task to show, handed out or received. Keyed per bot so dialog state never leaks across switches. */
export function TaskDockSlot({ botId }: { botId: string }) {
  const threads = useThreads(botId)
  const waitingWork = useWaitingWork()
  const dismissed = useDismissed(botId)
  if (!anyInDock(threads, botId, waitingWork, dismissed, Date.now())) return null
  return (
    <Suspense fallback={null}>
      <TaskDock key={botId} botId={botId} />
    </Suspense>
  )
}
