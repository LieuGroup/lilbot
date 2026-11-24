import type { Database } from 'bun:sqlite'
import { z } from 'zod'

export const HistorySearchInput = z.object({ query: z.string().trim().min(1).max(500), limit: z.number().int().min(1).max(50).default(20) })

export interface HistorySearchMatch {
  id: string
  sessionId: string
  at: number
  snippet: string
}

const notExcluded = (bot: string, session: string) => `NOT EXISTS (SELECT 1 FROM history_exclusions x WHERE x.bot=${bot} AND x.session=${session})`

export function searchHistory(db: Database, bot: string, query: string, limit = 20, allow?: (sessionId: string) => boolean): HistorySearchMatch[] {
  const terms = query
    .match(/[\p{L}\p{N}_]+/gu)
    ?.map(t => `"${t}"`)
    .join(' AND ')
  if (!terms) return []
  const sql = `SELECT i.id,i.session sessionId,i.at,snippet(history_search,0,'','',' … ',32) snippet FROM history_search f
    JOIN history_items i ON i.rowid=f.rowid WHERE history_search MATCH ? AND i.bot=? AND ${notExcluded('i.bot', 'i.session')}
    ORDER BY rank`
  if (!allow) return db.query(`${sql} LIMIT ?`).all(terms, bot, limit) as HistorySearchMatch[]
  const seen = new Map<string, boolean>()
  const matches: HistorySearchMatch[] = []
  const stmt = db.prepare(sql)
  try {
    for (const row of stmt.iterate(terms, bot) as Iterable<HistorySearchMatch>) {
      let ok = seen.get(row.sessionId)
      if (ok === undefined) {
        ok = allow(row.sessionId)
        seen.set(row.sessionId, ok)
      }
      if (!ok) continue
      matches.push(row)
      if (matches.length >= limit) break
    }
  } finally {
    stmt.finalize()
  }
  return matches
}
