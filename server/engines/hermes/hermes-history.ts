/** Read-only transcript access: never resumes an old session to import it. */
import type { ConversationSource } from '../bot-engine'
import { requireProfileEnvironment } from './hermes-environment'
import { historyCatalog } from './hermes-history-catalog'
import { historyRows } from './hermes-history-mapping'
import { HermesSocket } from './hermes-socket'

export async function conversations(nativeId: string): Promise<ConversationSource> {
  requireProfileEnvironment(nativeId)
  const socket = await HermesSocket.connect(
    nativeId === 'default' ? '' : nativeId,
    () => {},
    () => {}
  )
  return {
    close: () => socket.close(),
    async list() {
      // Canonical sessions remain in the live catalogue even after a client disconnects.
      // The stored catalogue supplies legacy/closed conversations; neither alone is complete.
      const [live, stored] = await Promise.all(['live', 'stored'].map(scope => socket.request('session.list', { scope, include_hidden: false, limit: 200 })))
      if (live.sessions.length === 200 || stored.sessions.length === 200) return historyCatalog(nativeId)
      return [
        ...new Map(
          [...stored.sessions, ...live.sessions]
            .filter((s: any) => !['tool', 'cron', 'subagent', 'unknown'].includes(s.source))
            .map((s: any) => [s.id, { id: s.id, at: Math.round((s.started_at ?? 0) * 1000) }])
        ).values()
      ] as { id: string; at: number }[]
    },
    async read(id, cursor, latest = false) {
      const result = await socket.request('session.transcript', {
        session_id: id,
        cursor: cursor ?? null,
        limit: 100,
        order: latest ? 'latest' : 'oldest'
      })
      const rows = historyRows(nativeId, result.rows)
      return { rows, cursor: result.next_cursor, reset: result.reset, empty: result.rows.length === 0 }
    }
  }
}
