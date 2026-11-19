/** The gateway's two listings cap at 200 without a cursor. Overflow discovery reads only
 * profile-local session metadata, read-only; all transcript contents still use the wire API. */
import { Database } from 'bun:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { requireProfileEnvironment } from './hermes-environment'

export function historyCatalog(nativeId: string) {
  requireProfileEnvironment(nativeId)
  const home = process.env.HERMES_HOME ?? join(homedir(), '.hermes')
  return readHistoryCatalog(join(home, ...(nativeId === 'default' ? [] : ['profiles', nativeId]), 'state.db'))
}

export function readHistoryCatalog(path: string): { id: string; at: number }[] {
  const db = new Database(path, { readonly: true })
  try {
    const rows = db
      .query(`SELECT id,started_at,parent_session_id,end_reason FROM sessions
      WHERE hidden=0 AND (archived=0 OR end_reason='compression')
      AND source NOT IN ('tool','cron','subagent','unknown','api_server','kanban')`)
      .all() as {
      id: string
      started_at: number
      parent_session_id: string | null
      end_reason: string | null
    }[]
    const byId = new Map(rows.map(row => [row.id, row]))
    const roots = new Map<string, { id: string; at: number }>()
    for (const row of rows) {
      let root = row
      const seen = new Set([row.id])
      while (root.parent_session_id) {
        const parent = byId.get(root.parent_session_id)
        if (parent?.end_reason !== 'compression' || seen.has(parent.id)) break
        seen.add(parent.id)
        root = parent
      }
      roots.set(root.id, { id: root.id, at: Math.round(root.started_at * 1000) })
    }
    return [...roots.values()]
  } finally {
    db.close()
  }
}
