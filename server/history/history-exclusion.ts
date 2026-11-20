import type { Database } from 'bun:sqlite'
import { LilBotError } from '../../shared/protocol'

export interface ExclusionPreview {
  already: boolean
  kinds: Record<string, number>
  events: number
  samples: { kind: string; text: string }[]
}

const SAMPLE_CHARS = 60
const SAMPLE_ROWS = 5

function assertExcludable(db: Database, bot: string, session: string) {
  const main = db.query('SELECT main_chat_id FROM bot_prefs WHERE bot_id=?').get(bot) as { main_chat_id: string | null } | null
  if (main?.main_chat_id === session) throw new LilBotError('active_session', 'This is the bot’s current main session; start a new session first, then exclude the old one.')
  const known =
    db.query('SELECT 1 FROM history_sessions WHERE bot=? AND id=?').get(bot, session) || db.query('SELECT 1 FROM history_items WHERE bot=? AND session=?').get(bot, session)
  if (!known) throw new LilBotError('unknown_session', 'LilBot’s copy has no such session for this bot.')
}

/** What excluding this session would remove from LilBot's copy. Reads only. */
export function previewExclusion(db: Database, bot: string, session: string): ExclusionPreview {
  const already = !!db.query('SELECT 1 FROM history_exclusions WHERE bot=? AND session=?').get(bot, session)
  if (!already) assertExcludable(db, bot, session)
  const kinds: Record<string, number> = {}
  for (const row of db.query(`SELECT json_extract(item,'$.kind') kind,count(*) n FROM history_items WHERE bot=? AND session=? GROUP BY kind`).all(bot, session) as {
    kind: string
    n: number
  }[])
    kinds[row.kind] = row.n
  const { events } = db.query('SELECT count(*) events FROM history_events WHERE bot=? AND session=?').get(bot, session) as { events: number }
  const samples = (
    db
      .query(
        `SELECT json_extract(item,'$.kind') kind,text FROM history_items WHERE bot=? AND session=? AND json_extract(item,'$.kind') IN ('user','assistant') ORDER BY at,position,id LIMIT ?`
      )
      .all(bot, session, SAMPLE_ROWS) as { kind: string; text: string }[]
  ).map(row => ({ kind: row.kind, text: row.text.replace(/\s+/g, ' ').slice(0, SAMPLE_CHARS) }))
  return { already, kinds, events, samples }
}

/** Removes one engine session from LilBot's copy and records it so no writer brings it back. Idempotent; never touches the engine. */
export function excludeSession(db: Database, bot: string, session: string, reason: string): boolean {
  return db
    .transaction(() => {
      if (db.query('SELECT 1 FROM history_exclusions WHERE bot=? AND session=?').get(bot, session)) return false
      assertExcludable(db, bot, session)
      db.query('INSERT INTO history_exclusions(bot,session,reason,at) VALUES(?,?,?,?)').run(bot, session, reason, Date.now())
      // Deleting items fires the search-index trigger; the session's divider is one of its items.
      db.query('DELETE FROM history_items WHERE bot=? AND session=?').run(bot, session)
      db.query('DELETE FROM history_events WHERE bot=? AND session=?').run(bot, session)
      db.query('DELETE FROM history_sessions WHERE bot=? AND id=?').run(bot, session)
      // The first remaining session starts the conversation and carries no divider.
      const first = db.query('SELECT id FROM history_sessions WHERE bot=? ORDER BY at,id LIMIT 1').get(bot) as { id: string } | null
      if (first) db.query('DELETE FROM history_items WHERE bot=? AND id=?').run(bot, `session:${first.id}`)
      return true
    })
    .immediate()
}
