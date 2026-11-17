import type { Database } from 'bun:sqlite'
import type { ComputerResult } from '../shared/computer-schema'
import { boundResult } from './result-bounds'

const expired = JSON.stringify({ output: '', error: 'Result expired. Request will not be re-executed.' })
export function prepareJournal(db: Database) {
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, result TEXT, finished_at INTEGER);')
  if (!(db.query('PRAGMA table_info(requests)').all() as { name: string }[]).some(c => c.name === 'finished_at')) db.exec('ALTER TABLE requests ADD COLUMN finished_at INTEGER')
  db.exec(
    'CREATE INDEX IF NOT EXISTS requests_expiry ON requests(finished_at); CREATE INDEX IF NOT EXISTS requests_unacknowledged ON requests(id) WHERE finished_at IS NOT NULL OR result IS NULL'
  )

  db.query('UPDATE requests SET result=?,finished_at=? WHERE result IS NULL').run(
    JSON.stringify({ output: '', error: 'Helper restarted during operation; outcome unknown. Not re-executed.' }),
    Date.now()
  )
  pruneJournal(db)
}
export function pruneJournal(db: Database, now = Date.now()) {
  // Unacknowledged results do not expire. Admission reserves their worst-case space.
  void db
  void now
}
export function acknowledge(db: Database, id: string) {
  // Keep the receipt, never the file contents, after confirmed delivery.
  db.query('UPDATE requests SET result=?,finished_at=NULL WHERE id=? AND result IS NOT NULL').run(expired, id)
}
export function canAdmit(db: Database) {
  const { count } = db.query('SELECT count(*) AS count FROM requests WHERE finished_at IS NOT NULL OR result IS NULL').get() as { count: number }
  return count < 32
}
export function finish(db: Database, id: string, result: ComputerResult) {
  db.query('UPDATE requests SET result=?,finished_at=? WHERE id=?').run(JSON.stringify(boundResult(result)), Date.now(), id)
}
