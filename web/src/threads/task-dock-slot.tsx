import { lazy, Suspense } from 'react'
import type { BotThread } from '../../../shared/thread-schema'
import type { WorkSummary } from '../../../shared/work-schema'
import { useThreadStore, useThreads, useWaitingWork } from './thread-store'

const TaskDock = lazy(() => import('./task-dock'))
const FINISHED_TTL_MS = 2 * 60_000

/** Lightweight first-load check mirroring `dock-items.ts` so the dock and thread-line modules stay lazy until needed. */
function anyInDock(threads: BotThread[] | undefined, botId: string, waiting: Record<string, WorkSummary>, dismissed: Record<string, number>, now: number) {
  if (!threads?.length) return false
  return threads.some(thread => {
    if (thread.group || thread.participants[0]?.id !== botId || thread.status === 'cancelled') return false
    const active = thread.status === 'waiting' || thread.status === 'working'
    if (thread.state === 'limited' && !active) return false
    if (waiting[thread.id]?.status === 'needs_oscar' || active) return true
    const stamp = thread.endedAt ?? thread.createdAt
    const gone = dismissed[`${botId}:${thread.id}`]
    if (gone !== undefined && gone >= stamp) return false
    if (thread.status === 'failed' || thread.state === 'failed') return true
    return thread.status === 'finished' && now - stamp < FINISHED_TTL_MS
  })
}

/** First-load gate for the composer-top tasks dock: watches `threads.list` and loads the dock chunk only once this bot has
 *  an in-flight, waiting, failed or recently finished task to show. */
export function TaskDockSlot({ botId }: { botId: string }) {
  const threads = useThreads(botId)
  const waitingWork = useWaitingWork()
  const dismissed = useThreadStore(state => state.dismissed)
  if (!anyInDock(threads, botId, waitingWork, dismissed, Date.now())) return null
  return (
    <Suspense fallback={null}>
      <TaskDock botId={botId} />
    </Suspense>
  )
}
