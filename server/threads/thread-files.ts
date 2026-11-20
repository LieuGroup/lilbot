/** Which files were passed in an exchange, by whom, and where each copy landed. All SQL for `thread_files` is here. */
import type { Database } from 'bun:sqlite'
import type { ExchangeFile } from '../../shared/thread-schema'

export interface FileRow {
  id: string
  thread_id: string
  /** The thread message the file travels with; an answer's files wait under its reply id until it is sent. */
  message_id: string
  sender: string
  name: string
  size: number
  sha256: string | null
  source: string
  copy: string | null
  at: number
}

export class ThreadFiles {
  constructor(private db: Database) {}
  add(row: Omit<FileRow, 'at'>) {
    this.db
      .query('INSERT OR IGNORE INTO thread_files(id,thread_id,message_id,sender,name,size,sha256,source,copy,at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(row.id, row.thread_id, row.message_id, row.sender, row.name, row.size, row.sha256, row.source, row.copy, Date.now())
  }
  forMessage(messageId: string): FileRow[] {
    return this.db.query('SELECT * FROM thread_files WHERE message_id=? ORDER BY rowid').all(messageId) as FileRow[]
  }
  copied(id: string, copy: string, sha256: string) {
    this.db.query('UPDATE thread_files SET copy=?, sha256=? WHERE id=?').run(copy, sha256, id)
  }
  /** Files per message of a thread, as the screens and bots see them. */
  byMessage(threadId: string): Map<string, ExchangeFile[]> {
    const out = new Map<string, ExchangeFile[]>()
    for (const row of this.db.query('SELECT * FROM thread_files WHERE thread_id=? ORDER BY rowid').all(threadId) as FileRow[])
      out.set(row.message_id, [...(out.get(row.message_id) ?? []), { name: row.name, size: row.size, fromId: row.sender, path: row.copy }])
    return out
  }
}
