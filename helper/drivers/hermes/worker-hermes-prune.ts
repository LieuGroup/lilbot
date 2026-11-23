/** Bounded 7-day retention pruning for hidden Hermes worker sessions tracked in the helper's `worker_runs` SQLite journal.
 *  Only considers sessions marked `created_by_helper` locally, and confirms with the gateway that each session is still
 *  hidden and was created as a worker `acp` session before issuing `delete`. Never wakes an idle gateway just to prune. */
import type { Database } from 'bun:sqlite'
import { markSessionPruned, sessionsToPrune } from '../../worker-journal'
import { HermesRpcError, type HermesWorkerSocket } from './worker-hermes-socket'

const HERMES_SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_PRUNE_PER_RUN = 10

function isHiddenWorkerAcpSnapshot(snap: unknown): snap is { revision?: unknown; execution_generation?: unknown; running?: unknown } {
  if (!snap || typeof snap !== 'object') return false
  const s = snap as { running?: unknown; info?: unknown }
  if (s.running === true || !s.info || typeof s.info !== 'object') return false
  const info = s.info as { source?: unknown; launch_request?: unknown }
  if (info.source !== 'acp' || !info.launch_request || typeof info.launch_request !== 'object') return false
  const lr = info.launch_request as { source?: unknown; yolo?: unknown; ignore_rules?: unknown }
  return lr.source === 'acp' && lr.yolo === true && lr.ignore_rules === true
}

async function listVisibleSessionIds(socket: HermesWorkerSocket): Promise<Set<string> | null> {
  try {
    const res = (await socket.request('session.list', { scope: 'stored', include_hidden: false, limit: 200 }, 10_000)) as { sessions?: unknown }
    const ids = new Set<string>()
    if (Array.isArray(res?.sessions)) {
      for (const row of res.sessions) {
        if (!row || typeof row !== 'object') continue
        const r = row as { session_id?: unknown; id?: unknown; resolved_id?: unknown }
        if (typeof r.session_id === 'string') ids.add(r.session_id)
        if (typeof r.id === 'string') ids.add(r.id)
        if (typeof r.resolved_id === 'string') ids.add(r.resolved_id)
      }
    }
    return ids
  } catch {
    return null
  }
}

export async function pruneOldHermesSessions(
  socket: HermesWorkerSocket,
  db: Database | undefined,
  options: { now?: number; maxAgeMs?: number; excludeSessionId?: string; limit?: number } = {}
): Promise<number> {
  if (!db || !socket.isOpen) return 0
  const cutoff = (options.now ?? Date.now()) - (options.maxAgeMs ?? HERMES_SESSION_RETENTION_MS)
  const candidates = sessionsToPrune(db, 'hermes', cutoff, options.limit ?? MAX_PRUNE_PER_RUN).filter(id => id !== options.excludeSessionId)
  if (!candidates.length) return 0
  const visibleIds = await listVisibleSessionIds(socket)
  if (!visibleIds) return 0
  let pruned = 0
  for (const sessionId of candidates) {
    if (!socket.isOpen) break
    if (visibleIds.has(sessionId)) continue
    try {
      const snap = await socket.request('session.resume', { session_id: sessionId, source: 'acp', omit_messages: true }, 10_000)
      if (!isHiddenWorkerAcpSnapshot(snap)) continue
      const revision = typeof snap.revision === 'number' ? snap.revision : 0
      const generation = typeof snap.execution_generation === 'number' ? snap.execution_generation : 0
      await socket.request(
        'session.mutate',
        {
          session_id: sessionId,
          request_id: `lilbot-prune-${sessionId}`,
          expected_revision: revision,
          expected_generation: generation,
          operation: 'delete',
          payload: {}
        },
        10_000
      )
      markSessionPruned(db, 'hermes', sessionId)
      pruned++
    } catch (error) {
      if (error instanceof HermesRpcError && (error.reason === 'not_found' || error.reason === 'session_not_found')) {
        markSessionPruned(db, 'hermes', sessionId)
        pruned++
      }
    }
  }
  return pruned
}
