/** The gateway's two listings cap at 200 without a cursor. Overflow discovery reads only
 * profile-local session metadata, read-only; all transcript contents still use the wire API. */
import { Database } from 'bun:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { requireProfileEnvironment } from './hermes-environment'

const statePath = (nativeId: string) => join(process.env.HERMES_HOME ?? join(homedir(), '.hermes'), ...(nativeId === 'default' ? [] : ['profiles', nativeId]), 'state.db')
const UNLISTED = ['tool', 'cron', 'subagent', 'unknown', 'api_server', 'kanban']

export function historyCatalog(nativeId: string) {
  requireProfileEnvironment(nativeId)
  return readHistoryCatalog(statePath(nativeId))
}

type Row = { id: string; started_at: number; parent_session_id: string | null; end_reason: string | null; hidden: number; archived: number; source: string }

/** Conversations by the session their compression lineage began as. Hermes writes a compression child without its
 *  parent's hidden mark, so a lineage is left out when any session in it is hidden or not a conversation. */
export function readHistoryCatalog(path: string): { id: string; at: number }[] {
  const db = new Database(path, { readonly: true })
  try {
    const rows = db.query('SELECT id,started_at,parent_session_id,end_reason,hidden,archived,source FROM sessions').all() as Row[]
    const byId = new Map(rows.map(row => [row.id, row]))
    const roots = new Map<string, { id: string; at: number }>()
    for (const row of rows) {
      if (row.archived && row.end_reason !== 'compression') continue
      const chain = [row]
      for (let parent = byId.get(row.parent_session_id ?? ''); parent?.end_reason === 'compression' && !chain.includes(parent); parent = byId.get(parent.parent_session_id ?? ''))
        chain.push(parent)
      if (chain.some(session => session.hidden || UNLISTED.includes(session.source))) continue
      const root = chain.at(-1)!
      roots.set(root.id, { id: root.id, at: Math.round(root.started_at * 1000) })
    }
    return [...roots.values()]
  } finally {
    db.close()
  }
}

/** See `BotEngine.compressionRoot`: follows parents that ended in compression. */
export function compressionRoot(nativeId: string, chatId: string): string | null {
  let db: Database | undefined
  try {
    requireProfileEnvironment(nativeId)
    db = new Database(statePath(nativeId), { readonly: true })
    db.run('PRAGMA busy_timeout = 250')
    const parent = db.query("SELECT p.id FROM sessions c JOIN sessions p ON p.id = c.parent_session_id WHERE c.id = ? AND p.end_reason = 'compression'")
    const seen = new Set([chatId])
    for (let id = chatId; ; ) {
      const row = parent.get(id) as { id: string } | null
      if (!row || seen.has(row.id)) return id
      seen.add(row.id)
      id = row.id
    }
  } catch {
    return null
  } finally {
    db?.close()
  }
}
