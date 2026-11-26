/** The files bots showed in their replies (#317): the saved path inside the bot's folder, never a copy. */
import type { Database } from 'bun:sqlite'
import type { ShownKind } from '../../shared/shown-rules'

export interface ShownRow {
  id: string
  botId: string
  chatId: string
  path: string
  name: string
  kind: ShownKind
  mime: string
  size: number
  caption: string | null
  createdAt: number
}

type Stored = { id: string; bot_id: string; chat_id: string; path: string; name: string; kind: ShownKind; mime: string; size: number; caption: string | null; created_at: number }
const fromStored = (r: Stored): ShownRow => ({
  id: r.id,
  botId: r.bot_id,
  chatId: r.chat_id,
  path: r.path,
  name: r.name,
  kind: r.kind,
  mime: r.mime,
  size: r.size,
  caption: r.caption,
  createdAt: r.created_at
})

export class ShownStore {
  constructor(private db: Database) {}
  add(row: ShownRow) {
    this.db
      .query('INSERT INTO shown_files(id,bot_id,chat_id,path,name,kind,mime,size,caption,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(row.id, row.botId, row.chatId, row.path, row.name, row.kind, row.mime, row.size, row.caption, row.createdAt)
  }
  get(botId: string, id: string): ShownRow | null {
    const row = this.db.query('SELECT * FROM shown_files WHERE bot_id=? AND id=?').get(botId, id) as Stored | null
    return row ? fromStored(row) : null
  }
  /** Files shown in this conversation since its current reply began: Oscar's latest message or the turn's start. */
  inCurrentReply(botId: string, chatId: string): number {
    const { count } = this.db
      .query(
        `SELECT count(*) count FROM shown_files WHERE bot_id=?1 AND chat_id=?2 AND created_at >= coalesce((SELECT max(at) FROM history_events
         WHERE bot=?1 AND session=?2 AND json_extract(event,'$.type') IN ('user.message','turn.started')), 0)`
      )
      .get(botId, chatId) as { count: number }
    return count
  }
  forgetBot(botId: string) {
    this.db.query('DELETE FROM shown_files WHERE bot_id=?').run(botId)
  }
}
