import type { Database } from 'bun:sqlite'
import type { LibraryItem, LibraryKind } from '../../shared/library-schema'

type StoredItem = Omit<LibraryItem, 'missing' | 'group'>
export class LibraryStore {
  constructor(private db: Database) {}
  add(item: StoredItem) {
    this.db
      .query('INSERT INTO library_items (id, bot_id, title, path, kind, size, created_at, chat_id, routine_run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(item.id, item.botId, item.title, item.path, item.kind, item.size, item.createdAt, item.chatId, item.routineRunId)
    return item
  }
  private select = 'SELECT id, bot_id AS botId, title, path, kind, size, created_at AS createdAt, chat_id AS chatId, routine_run_id AS routineRunId FROM library_items'
  get(botId: string, id: string) {
    return this.db.query(`${this.select} WHERE bot_id = ? AND id = ?`).get(botId, id) as StoredItem | null
  }
  list(botId: string, kind: LibraryKind | undefined, offset: number, limit: number) {
    return this.db
      .query(`${this.select} WHERE bot_id = ? AND (? IS NULL OR kind = ?) ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
      .all(botId, kind ?? null, kind ?? null, limit, offset) as StoredItem[]
  }
  count(botId: string, kind?: LibraryKind) {
    return (this.db.query('SELECT count(*) AS n FROM library_items WHERE bot_id = ? AND (? IS NULL OR kind = ?)').get(botId, kind ?? null, kind ?? null) as { n: number }).n
  }
}
