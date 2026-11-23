/** Bounded 7-day retention pruning for hidden Hermes worker sessions tracked in the helper's `worker_runs` SQLite journal.
 *  Runs opportunistically on an already-open Hermes gateway socket so it never wakes an idle gateway just to prune. */
import type { Database } from 'bun:sqlite'
import { HermesRpcError, type HermesWorkerSocket } from './worker-hermes-socket'
import { hermesSessionsToPrune, markHermesSessionPruned } from './worker-journal'

const HERMES_SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_PRUNE_PER_RUN = 10

export async function pruneOldHermesSessions(
  socket: HermesWorkerSocket,
  db: Database | undefined,
  options: { now?: number; maxAgeMs?: number; excludeSessionId?: string; limit?: number } = {}
): Promise<number> {
  if (!db || !socket.isOpen) return 0
  const cutoff = (options.now ?? Date.now()) - (options.maxAgeMs ?? HERMES_SESSION_RETENTION_MS)
  const candidates = hermesSessionsToPrune(db, cutoff, options.limit ?? MAX_PRUNE_PER_RUN).filter(id => id !== options.excludeSessionId)
  let pruned = 0
  for (const sessionId of candidates) {
    if (!socket.isOpen) break
    try {
      const snap = (await socket.request('session.resume', { session_id: sessionId, source: 'acp', omit_messages: true }, 10_000)) as {
        revision?: unknown
        execution_generation?: unknown
        running?: unknown
      }
      if (snap?.running === true) continue
      const revision = typeof snap?.revision === 'number' ? snap.revision : 0
      const generation = typeof snap?.execution_generation === 'number' ? snap.execution_generation : 0
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
      markHermesSessionPruned(db, sessionId)
      pruned++
    } catch (error) {
      if (error instanceof HermesRpcError && (error.reason === 'not_found' || error.reason === 'session_not_found')) {
        markHermesSessionPruned(db, sessionId)
        pruned++
      }
    }
  }
  return pruned
}
