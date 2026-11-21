import type { Database } from 'bun:sqlite'
import type { LibraryItem, LibraryKind } from '../../shared/library-schema'

type StoredItem = Omit<LibraryItem, 'missing' | 'mime' | 'url'>
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
  list(botId: string, kinds: LibraryKind[] | undefined, offset: number, limit: number) {
    return this.db
      .query(`${this.select} WHERE bot_id = ? AND (? IS NULL OR kind IN (SELECT value FROM json_each(?))) ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
      .all(botId, ...kindsFilter(kinds), limit, offset) as StoredItem[]
  }
  count(botId: string, kinds?: LibraryKind[]) {
    return (
      this.db.query('SELECT count(*) AS n FROM library_items WHERE bot_id = ? AND (? IS NULL OR kind IN (SELECT value FROM json_each(?)))').get(botId, ...kindsFilter(kinds)) as {
        n: number
      }
    ).n
  }
}

const kindsFilter = (kinds: LibraryKind[] | undefined) => {
  const json = kinds ? JSON.stringify(kinds) : null
  return [json, json] as const
}
