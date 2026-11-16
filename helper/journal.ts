import type { Database } from 'bun:sqlite'
import type { ComputerResult } from '../shared/computer-schema'

const expired = JSON.stringify({ output: '', error: 'Result expired. Request will not be re-executed.' })
export function prepareJournal(db: Database) {
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, result TEXT, finished_at INTEGER);')
  if (!(db.query('PRAGMA table_info(requests)').all() as { name: string }[]).some(c => c.name === 'finished_at')) db.exec('ALTER TABLE requests ADD COLUMN finished_at INTEGER')
  db.query('UPDATE requests SET finished_at=? WHERE finished_at IS NULL AND result IS NOT NULL').run(Date.now())
  db.query('UPDATE requests SET result=?,finished_at=? WHERE result IS NULL').run(
    JSON.stringify({ output: '', error: 'Helper restarted during operation; outcome unknown. Not re-executed.' }),
    Date.now()
  )
  pruneJournal(db)
}
export function pruneJournal(db: Database, now = Date.now()) {
  db.query('UPDATE requests SET result=? WHERE finished_at<?').run(expired, now - 7 * 24 * 60 * 60_000)
}
export function acknowledge(db: Database, id: string) {
  // Keep the receipt, never the file contents, after confirmed delivery.
  db.query('UPDATE requests SET result=? WHERE id=? AND result IS NOT NULL').run(expired, id)
}
export function finish(db: Database, id: string, result: ComputerResult) {
  db.query('UPDATE requests SET result=?,finished_at=? WHERE id=?').run(JSON.stringify(result), Date.now(), id)
}
