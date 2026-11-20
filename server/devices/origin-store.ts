import type { Database } from 'bun:sqlite'
import type { MessageOrigin } from '../../shared/device-schema'

/** A message waits this long for the history importer to find its row (a prompt queued behind a long turn is slow). */
const PENDING_MS = 6 * 60 * 60_000
const CLOCK_SKEW_MS = 5_000

/** Which device each plain chat message came from. Hermes' transcript rows carry no id LilBot sent, and Oscar's stored
 *  text is never changed to add one, so the importer matches a row to the oldest waiting message of that bot with the
 *  same text sent just before it. A matched row is remembered by its id, so importing a page again gives the same answer. */
export class OriginStore {
  constructor(private db: Database) {}
  record(botId: string, messageId: string, text: string, origin: MessageOrigin, now: number) {
    this.db.query('DELETE FROM message_origins WHERE row_id IS NULL AND at < ?').run(now - PENDING_MS)
    this.db
      .query('INSERT OR IGNORE INTO message_origins(id,bot_id,text,device_id,device_name,at) VALUES(?,?,?,?,?,?)')
      .run(messageId, botId, text, origin.deviceId, origin.name, now)
  }
  /** A message that was refused by the engine is not waiting for a row. */
  forget(messageId: string) {
    this.db.query('DELETE FROM message_origins WHERE id=? AND row_id IS NULL').run(messageId)
  }
  forgetBot(botId: string) {
    this.db.query('DELETE FROM message_origins WHERE bot_id=?').run(botId)
  }
  /** The device a user row was sent from, or nothing (messages from before devices, or from another client). */
  match(botId: string, rowId: string, text: string, at: number): MessageOrigin | undefined {
    type Found = { id: string; device_id: string; device_name: string }
    const own = this.db.query('SELECT id,device_id,device_name FROM message_origins WHERE bot_id=? AND row_id=?').get(botId, rowId) as Found | null
    const waiting =
      own ??
      (this.db
        .query('SELECT id,device_id,device_name FROM message_origins WHERE bot_id=? AND row_id IS NULL AND text=? AND at<=? AND at>=? ORDER BY at,rowid LIMIT 1')
        .get(botId, text, at + CLOCK_SKEW_MS, at - PENDING_MS) as Found | null)
    if (!waiting) return undefined
    // Once matched, only the row id is needed: the text is already in the history.
    if (!own) this.db.query("UPDATE message_origins SET row_id=?, text='' WHERE id=?").run(rowId, waiting.id)
    return { deviceId: waiting.device_id, name: waiting.device_name }
  }
}
